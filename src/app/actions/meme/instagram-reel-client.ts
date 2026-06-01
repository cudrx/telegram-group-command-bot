import path from 'node:path';

import {
  execMediaFileDefault,
  MEDIA_EXEC_MAX_BUFFER,
  type MediaExecFile
} from '../../../media/exec.js';
import type { DownloadedMemeMedia } from './types.js';
import {
  DIRECT_VIDEO_MAX_DURATION_SECONDS,
  downloadTelegramSafeVideoWithYtDlp
} from './video-pipeline.js';

const YT_DLP_BIN = 'yt-dlp';
const INSTAGRAM_FORMAT_SELECTOR =
  'bestvideo[protocol=m3u8_native][ext=mp4]+bestaudio[ext=m4a]/bestvideo[protocol^=m3u8][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc1][acodec^=mp4a]/best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';

export type InstagramReelDownloadResult = {
  caption: string;
  sourceUrl: string;
  downloaded: DownloadedMemeMedia;
};

export function findInstagramReelUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];

  for (const match of matches) {
    const parsed = parseInstagramReelUrl(match);

    if (parsed) return parsed;
  }

  return null;
}

export async function downloadInstagramReelWithYtDlp(input: {
  text: string;
  sqlitePath: string;
  instagramCookiesPath?: string | null | undefined;
  maxBytes: number;
  captionMaxLength: number;
  execFile?: MediaExecFile | undefined;
}): Promise<InstagramReelDownloadResult | null> {
  const reelUrl = findInstagramReelUrl(input.text);
  if (!reelUrl) return null;

  const execFile = input.execFile ?? execMediaFileDefault;
  const cookiesPath =
    input.instagramCookiesPath ??
    path.join(path.dirname(input.sqlitePath), 'instagram-cookies.txt');
  const metadata = await fetchInstagramMetadata({
    execFile,
    cookiesPath,
    url: reelUrl
  });
  if (
    metadata.durationSeconds !== null &&
    metadata.durationSeconds > DIRECT_VIDEO_MAX_DURATION_SECONDS
  ) {
    return null;
  }

  const sourceUrl = reelUrl;
  const downloaded = await downloadTelegramSafeVideoWithYtDlp({
    execFile,
    url: sourceUrl,
    tempPrefix: 'instagram-ytdlp-',
    maxBytes: input.maxBytes,
    maxDurationSeconds: DIRECT_VIDEO_MAX_DURATION_SECONDS,
    durationSeconds: metadata.durationSeconds,
    ytDlpArgs: ['--cookies', cookiesPath, '-f', INSTAGRAM_FORMAT_SELECTOR]
  });

  return {
    caption: formatInstagramReelCaption({
      nickname: metadata.channel ?? metadata.uploader ?? 'unknown',
      likeCount: metadata.likeCount ?? 0,
      reelUrl: sourceUrl
    }),
    sourceUrl,
    downloaded
  };
}

export function formatInstagramReelCaption(input: {
  nickname: string;
  likeCount: number;
  reelUrl: string;
}): string {
  const name = `inst: ${input.nickname}`;
  const metadata = `likes: <a href="${escapeAttribute(input.reelUrl)}">${formatInteger(
    input.likeCount
  )}</a>`;

  return `${escapeHtml(name)} · ${metadata}`;
}

function parseInstagramReelUrl(value: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(stripTrailingPunctuation(value));
  } catch {
    return null;
  }

  if (!isInstagramHost(parsed.hostname)) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  const reelIndex = parts.findIndex((part) =>
    ['reel', 'reels'].includes(part.toLowerCase())
  );
  const shortcode = reelIndex >= 0 ? parts[reelIndex + 1] : undefined;

  if (!shortcode) return null;

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = `/${parts[reelIndex]}/${shortcode}/`;

  return parsed.toString();
}

async function fetchInstagramMetadata(input: {
  execFile: MediaExecFile;
  cookiesPath: string;
  url: string;
}): Promise<{
  title: string | null;
  description: string | null;
  channel: string | null;
  uploader: string | null;
  likeCount: number | null;
  durationSeconds: number | null;
  webpageUrl: string | null;
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
    title: readString(payload, 'title'),
    description: readString(payload, 'description'),
    channel: readString(payload, 'channel'),
    uploader: readString(payload, 'uploader'),
    likeCount: readNumber(payload, 'like_count'),
    durationSeconds: readNumber(payload, 'duration'),
    webpageUrl: readString(payload, 'webpage_url')
  };
}

function isInstagramHost(hostname: string): boolean {
  return hostname === 'instagram.com' || hostname.endsWith('.instagram.com');
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.]+$/u, '');
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
