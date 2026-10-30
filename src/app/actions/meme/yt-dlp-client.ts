import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { redditMediaActionConfig } from '../../../config/runtime/index.js';

import {
  execMediaFileDefault,
  MEDIA_EXEC_MAX_BUFFER,
  type MediaExecFile
} from '../../../media/exec.js';
import type { ProcessStatusReporter } from '../../process-status.js';
import { resolveRuntimeFilePath } from './paths.js';
import {
  findRedditPostReference,
  findRedditShareUrl
} from './reddit-post-client.js';
import type { DownloadedMemeMedia, MemePostCandidate } from './types.js';
import {
  DIRECT_VIDEO_MAX_DURATION_SECONDS,
  DirectVideoTooLongError,
  downloadTelegramSafeVideoWithYtDlp,
  readYtDlpRequestedDownloadBytes
} from './video-pipeline.js';

const YT_DLP_BIN = 'yt-dlp';
const REDDIT_FORMAT_SELECTOR =
  'bestvideo[protocol=m3u8_native][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best';

export type YtDlpRedditVideoResult = {
  candidate: MemePostCandidate;
  downloaded: DownloadedMemeMedia;
};

export async function downloadRedditVideoWithYtDlp(input: {
  text: string;
  sqlitePath: string;
  redditCookiesPath?: string | null | undefined;
  maxBytes: number;
  processStatus?: ProcessStatusReporter | undefined;
  execFile?: MediaExecFile | undefined;
}): Promise<YtDlpRedditVideoResult | null> {
  const directReference = findRedditPostReference(input.text);
  const sourceUrl =
    directReference?.permalink ?? findRedditShareUrl(input.text);
  if (!sourceUrl) return null;

  const execFile = input.execFile ?? execMediaFileDefault;
  const cookiesPath = resolveRuntimeFilePath(
    input.redditCookiesPath ??
      path.join(path.dirname(input.sqlitePath), 'reddit-cookies.txt')
  );
  const ytDlpArgs = [
    '--impersonate',
    'chrome',
    '--cookies',
    cookiesPath,
    '-f',
    REDDIT_FORMAT_SELECTOR
  ];
  await input.processStatus?.stage('metadata');
  const metadata = await fetchYtDlpMetadata({
    execFile,
    ytDlpArgs,
    url: sourceUrl
  });
  const reference =
    directReference ?? findRedditPostReference(metadata.webpageUrl ?? '');
  if (!reference) {
    throw new Error(
      `yt-dlp did not return a Reddit post reference for ${sourceUrl}`
    );
  }
  if (
    metadata.durationSeconds !== null &&
    metadata.durationSeconds > DIRECT_VIDEO_MAX_DURATION_SECONDS
  ) {
    throw new DirectVideoTooLongError(
      metadata.durationSeconds,
      DIRECT_VIDEO_MAX_DURATION_SECONDS
    );
  }

  const downloaded = await downloadTelegramSafeVideoWithYtDlp({
    execFile,
    url: reference.permalink,
    tempPrefix: 'reddit-ytdlp-',
    maxBytes: input.maxBytes,
    estimatedDownloadBytes: metadata.estimatedDownloadBytes,
    maxDurationSeconds: DIRECT_VIDEO_MAX_DURATION_SECONDS,
    durationSeconds: metadata.durationSeconds ?? null,
    ...(input.processStatus ? { processStatus: input.processStatus } : {}),
    ytDlpArgs
  });

  return {
    candidate: {
      redditPostId: reference.redditPostId,
      subreddit: reference.subreddit,
      title: metadata.title ?? 'Reddit video',
      permalink: reference.permalink,
      upvotes: metadata.upvotes ?? 0,
      media: {
        kind: 'video',
        mediaUrl: `yt-dlp:${metadata.id ?? reference.redditPostId}`,
        extension: 'mp4',
        durationSeconds: metadata.durationSeconds ?? null,
        ...(metadata.hasSpoiler ? { hasSpoiler: true } : {})
      }
    },
    downloaded
  };
}

async function fetchYtDlpMetadata(input: {
  execFile: MediaExecFile;
  ytDlpArgs: string[];
  url: string;
}): Promise<{
  id: string | null;
  webpageUrl: string | null;
  title: string | null;
  upvotes: number | null;
  durationSeconds: number | null;
  estimatedDownloadBytes: number | null;
  hasSpoiler: boolean;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'reddit-metadata-'));
  try {
    const result = await input.execFile(
      YT_DLP_BIN,
      [
        ...input.ytDlpArgs,
        '--write-pages',
        '--dump-single-json',
        '--no-playlist',
        input.url
      ],
      {
        cwd: directory,
        maxBuffer: MEDIA_EXEC_MAX_BUFFER,
        timeoutMs: redditMediaActionConfig.telegramMedia.metadataTimeoutMs
      }
    );
    const payload = JSON.parse(result.stdout) as unknown;
    const hasSpoiler = await readRedditSpoiler(directory);

    return {
      id: readString(payload, 'id'),
      webpageUrl: readString(payload, 'webpage_url'),
      title: readString(payload, 'alt_title') ?? readString(payload, 'title'),
      upvotes: readNumber(payload, 'like_count') ?? readNumber(payload, 'ups'),
      durationSeconds: readNumber(payload, 'duration'),
      estimatedDownloadBytes: readYtDlpRequestedDownloadBytes(payload),
      hasSpoiler
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readRedditSpoiler(directory: string): Promise<boolean> {
  for (const name of await readdir(directory)) {
    if (!name.includes('reddit.com_') || !name.endsWith('.json.dump')) continue;

    const payload: unknown = JSON.parse(
      await readFile(path.join(directory, name), 'utf8')
    );
    const listing = Array.isArray(payload) ? payload[0] : null;
    const data =
      isRecord(listing) && isRecord(listing.data) ? listing.data : null;
    const child =
      data && Array.isArray(data.children) ? data.children[0] : null;
    const post = isRecord(child) && isRecord(child.data) ? child.data : null;
    if (
      post &&
      typeof post.spoiler === 'boolean' &&
      typeof post.over_18 === 'boolean'
    ) {
      return post.spoiler || post.over_18;
    }
  }

  throw new Error('yt-dlp did not save Reddit spoiler metadata');
}

function readString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;

  const field = value[key];

  return typeof field === 'string' && field.trim().length > 0
    ? field.trim()
    : null;
}

function readNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;

  const field = value[key];

  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
