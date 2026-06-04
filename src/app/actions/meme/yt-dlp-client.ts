import path from 'node:path';

import {
  execMediaFileDefault,
  MEDIA_EXEC_MAX_BUFFER,
  type MediaExecFile
} from '../../../media/exec.js';
import type { ProcessStatusReporter } from '../../process-status.js';
import { resolveRedditPostReference } from './reddit-post-client.js';
import type { DownloadedMemeMedia, MemePostCandidate } from './types.js';
import {
  DIRECT_VIDEO_MAX_DURATION_SECONDS,
  downloadTelegramSafeVideoWithYtDlp
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
  fetch?: typeof fetch | undefined;
  processStatus?: ProcessStatusReporter | undefined;
  execFile?: MediaExecFile | undefined;
}): Promise<YtDlpRedditVideoResult | null> {
  const reference = await resolveRedditPostReference({
    text: input.text,
    sqlitePath: input.sqlitePath,
    redditCookiesPath: input.redditCookiesPath,
    ...(input.fetch ? { fetch: input.fetch } : {})
  });

  if (!reference) return null;

  const execFile = input.execFile ?? execMediaFileDefault;
  const cookiesPath =
    input.redditCookiesPath ??
    path.join(path.dirname(input.sqlitePath), 'reddit-cookies.txt');
  await input.processStatus?.stage('metadata');
  const metadata = await fetchYtDlpMetadata({
    execFile,
    cookiesPath,
    url: reference.permalink
  });
  if (
    metadata.durationSeconds !== null &&
    metadata.durationSeconds > DIRECT_VIDEO_MAX_DURATION_SECONDS
  ) {
    return null;
  }

  const downloaded = await downloadTelegramSafeVideoWithYtDlp({
    execFile,
    url: reference.permalink,
    tempPrefix: 'reddit-ytdlp-',
    maxBytes: input.maxBytes,
    maxDurationSeconds: DIRECT_VIDEO_MAX_DURATION_SECONDS,
    durationSeconds: metadata.durationSeconds ?? null,
    ...(input.processStatus ? { processStatus: input.processStatus } : {}),
    ytDlpArgs: ['--cookies', cookiesPath, '-f', REDDIT_FORMAT_SELECTOR]
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
  cookiesPath: string;
  url: string;
}): Promise<{
  id: string | null;
  title: string | null;
  upvotes: number | null;
  durationSeconds: number | null;
  hasSpoiler: boolean;
}> {
  const result = await input.execFile(
    YT_DLP_BIN,
    [
      '--cookies',
      input.cookiesPath,
      '--dump-single-json',
      '--no-playlist',
      input.url
    ],
    { maxBuffer: MEDIA_EXEC_MAX_BUFFER }
  );
  const payload = JSON.parse(result.stdout) as unknown;

  return {
    id: readString(payload, 'id'),
    title: readString(payload, 'title'),
    upvotes: readNumber(payload, 'like_count') ?? readNumber(payload, 'ups'),
    durationSeconds: readNumber(payload, 'duration'),
    hasSpoiler: (readNumber(payload, 'age_limit') ?? 0) > 0
  };
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
