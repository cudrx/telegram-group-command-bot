import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { findRedditPostReference } from './reddit-post-client.js';
import type { DownloadedMemeMedia, MemePostCandidate } from './types.js';

const execFileDefault = promisify(execFileCallback);
const YT_DLP_BIN = 'yt-dlp';
const COOKIES_FILENAME = 'reddit-cookies.txt';

export type YtDlpExecFile = (
  file: string,
  args: string[],
  options?: { cwd?: string | undefined }
) => Promise<{ stdout: string; stderr: string }>;

export type YtDlpRedditVideoResult = {
  candidate: MemePostCandidate;
  downloaded: DownloadedMemeMedia;
};

export async function downloadRedditVideoWithYtDlp(input: {
  text: string;
  sqlitePath: string;
  maxBytes: number;
  execFile?: YtDlpExecFile | undefined;
}): Promise<YtDlpRedditVideoResult | null> {
  const reference = findRedditPostReference(input.text);

  if (!reference) return null;

  const execFile = input.execFile ?? execFileDefault;
  const cookiesPath = path.join(
    path.dirname(input.sqlitePath),
    COOKIES_FILENAME
  );
  const metadata = await fetchYtDlpMetadata({
    execFile,
    cookiesPath,
    url: reference.permalink
  });
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'reddit-ytdlp-'));

  try {
    await execFile(
      YT_DLP_BIN,
      [
        '--cookies',
        cookiesPath,
        '--no-playlist',
        '--max-filesize',
        formatMaxFilesize(input.maxBytes),
        '-f',
        'best[ext=mp4]/best',
        '-o',
        path.join(tempDirectory, '%(id)s.%(ext)s'),
        reference.permalink
      ],
      { cwd: tempDirectory }
    );

    const filePath = await findDownloadedMp4(tempDirectory);
    const fileStat = await stat(filePath);

    if (fileStat.size > input.maxBytes) {
      throw new Error(`Media file is too large: ${fileStat.size} bytes.`);
    }

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
          durationSeconds: metadata.durationSeconds ?? null
        }
      },
      downloaded: {
        kind: 'video',
        filePath,
        extension: 'mp4',
        durationSeconds: metadata.durationSeconds ?? null,
        cleanup: async () => {
          await rm(tempDirectory, { recursive: true, force: true });
        }
      }
    };
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function fetchYtDlpMetadata(input: {
  execFile: YtDlpExecFile;
  cookiesPath: string;
  url: string;
}): Promise<{
  id: string | null;
  title: string | null;
  upvotes: number | null;
  durationSeconds: number | null;
}> {
  const result = await input.execFile(YT_DLP_BIN, [
    '--cookies',
    input.cookiesPath,
    '--dump-single-json',
    '--no-playlist',
    input.url
  ]);
  const payload = JSON.parse(result.stdout) as unknown;

  return {
    id: readString(payload, 'id'),
    title: readString(payload, 'title'),
    upvotes: readNumber(payload, 'like_count') ?? readNumber(payload, 'ups'),
    durationSeconds: readNumber(payload, 'duration')
  };
}

async function findDownloadedMp4(directory: string): Promise<string> {
  const entries = await readdir(directory);
  const mp4 = entries.find((entry) => entry.toLowerCase().endsWith('.mp4'));

  if (!mp4) {
    throw new Error('yt-dlp did not produce an mp4 file.');
  }

  return path.join(directory, mp4);
}

function formatMaxFilesize(maxBytes: number): string {
  return `${Math.floor(maxBytes / 1_000_000)}M`;
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
