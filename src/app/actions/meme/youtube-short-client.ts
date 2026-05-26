import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { DownloadedMemeMedia } from './types.js';
import type { YtDlpExecFile } from './yt-dlp-client.js';

const execFileDefault = promisify(execFileCallback);
const YT_DLP_BIN = 'yt-dlp';
const YOUTUBE_FORMAT_SELECTOR =
  'bestvideo[protocol=m3u8_native][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best';

export type YoutubeShortDownloadResult = {
  caption: string;
  sourceUrl: string;
  downloaded: DownloadedMemeMedia;
};

export function findYoutubeShortUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];

  for (const match of matches) {
    const parsed = parseYoutubeShortUrl(match);

    if (parsed) return parsed;
  }

  return null;
}

export async function downloadYoutubeShortWithYtDlp(input: {
  text: string;
  sqlitePath: string;
  youtubeCookiesPath?: string | null | undefined;
  maxBytes: number;
  captionMaxLength: number;
  execFile?: YtDlpExecFile | undefined;
}): Promise<YoutubeShortDownloadResult | null> {
  const shortUrl = findYoutubeShortUrl(input.text);
  if (!shortUrl) return null;

  const execFile = input.execFile ?? execFileDefault;
  const cookiesPath =
    input.youtubeCookiesPath ??
    path.join(path.dirname(input.sqlitePath), 'youtube-cookies.txt');
  const metadata = await fetchYoutubeMetadata({
    execFile,
    cookiesPath,
    url: shortUrl
  });
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'youtube-ytdlp-'));

  try {
    await execFile(
      YT_DLP_BIN,
      [
        '--cookies',
        cookiesPath,
        '--no-playlist',
        '--max-filesize',
        formatMaxFilesize(input.maxBytes),
        '--merge-output-format',
        'mp4',
        '-f',
        YOUTUBE_FORMAT_SELECTOR,
        '-o',
        path.join(tempDirectory, '%(id)s.%(ext)s'),
        shortUrl
      ],
      { cwd: tempDirectory }
    );

    const filePath = await findDownloadedMp4(tempDirectory);
    const fileStat = await stat(filePath);

    if (fileStat.size > input.maxBytes) {
      throw new Error(`Media file is too large: ${fileStat.size} bytes.`);
    }

    return {
      caption: formatYoutubeShortCaption({
        channel: metadata.channel ?? metadata.uploader ?? 'unknown',
        likeCount: metadata.likeCount ?? 0,
        shortUrl
      }),
      sourceUrl: shortUrl,
      downloaded: {
        kind: 'video',
        filePath,
        extension: 'mp4',
        durationSeconds: metadata.durationSeconds,
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

export function formatYoutubeShortCaption(input: {
  channel: string;
  likeCount: number;
  shortUrl: string;
}): string {
  const name = `yt: ${input.channel}`;
  const metadata = `likes: <a href="${escapeAttribute(input.shortUrl)}">${formatInteger(
    input.likeCount
  )}</a>`;

  return `${escapeHtml(name)} · ${metadata}`;
}

function parseYoutubeShortUrl(value: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(stripTrailingPunctuation(value));
  } catch {
    return null;
  }

  const id = getYoutubeVideoId(parsed);
  if (!id) return null;

  return `https://www.youtube.com/shorts/${id}`;
}

function getYoutubeVideoId(parsed: URL): string | null {
  if (parsed.hostname === 'youtu.be') {
    return getRequiredString(parsed.pathname.split('/').filter(Boolean)[0]);
  }

  if (!isYoutubeHost(parsed.hostname)) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() === 'shorts') {
    return getRequiredString(parts[1]);
  }

  if (parsed.pathname === '/watch') {
    return getRequiredString(parsed.searchParams.get('v'));
  }

  return null;
}

async function fetchYoutubeMetadata(input: {
  execFile: YtDlpExecFile;
  cookiesPath: string;
  url: string;
}): Promise<{
  channel: string | null;
  uploader: string | null;
  likeCount: number | null;
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
    channel: readString(payload, 'channel'),
    uploader: readString(payload, 'uploader'),
    likeCount: readNumber(payload, 'like_count'),
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

function isYoutubeHost(hostname: string): boolean {
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.]+$/u, '');
}

function getRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function formatMaxFilesize(maxBytes: number): string {
  return `${Math.floor(maxBytes / 1_000_000)}M`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0
  })
    .format(value)
    .replace(/\u00a0/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
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
