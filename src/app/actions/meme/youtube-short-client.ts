import path from 'node:path';

import type { DownloadedMemeMedia } from './types.js';
import {
  downloadTelegramSafeVideoWithYtDlp,
  execMediaFileDefault,
  MEDIA_EXEC_MAX_BUFFER,
  type MediaExecFile
} from './video-pipeline.js';

const YT_DLP_BIN = 'yt-dlp';
const YOUTUBE_JS_RUNTIME_ARGS = ['--js-runtimes', 'node'] as const;
const YOUTUBE_FORMAT_SELECTOR =
  'bv*[ext=mp4][vcodec^=avc1][height<=1280]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1][height<=1280]/b[ext=mp4][height<=1280]/b[ext=mp4]';

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
  execFile?: MediaExecFile | undefined;
}): Promise<YoutubeShortDownloadResult | null> {
  const shortUrl = findYoutubeShortUrl(input.text);
  if (!shortUrl) return null;

  const execFile = input.execFile ?? execMediaFileDefault;
  const cookiesPath =
    input.youtubeCookiesPath ??
    path.join(path.dirname(input.sqlitePath), 'youtube-cookies.txt');
  const metadata = await fetchYoutubeMetadata({
    execFile,
    cookiesPath,
    url: shortUrl
  });
  const downloaded = await downloadTelegramSafeVideoWithYtDlp({
    execFile,
    url: shortUrl,
    tempPrefix: 'youtube-ytdlp-',
    maxBytes: input.maxBytes,
    durationSeconds: metadata.durationSeconds,
    ytDlpArgs: [
      ...YOUTUBE_JS_RUNTIME_ARGS,
      '--cookies',
      cookiesPath,
      '-f',
      YOUTUBE_FORMAT_SELECTOR,
      '-S',
      'vcodec:h264,res,ext:mp4:m4a'
    ]
  });

  return {
    caption: formatYoutubeShortCaption({
      channel: metadata.channel ?? metadata.uploader ?? 'unknown',
      likeCount: metadata.likeCount ?? 0,
      shortUrl
    }),
    sourceUrl: shortUrl,
    downloaded
  };
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
  execFile: MediaExecFile;
  cookiesPath: string;
  url: string;
}): Promise<{
  channel: string | null;
  uploader: string | null;
  likeCount: number | null;
  durationSeconds: number | null;
}> {
  const result = await input.execFile(
    YT_DLP_BIN,
    [
      ...YOUTUBE_JS_RUNTIME_ARGS,
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
    channel: readString(payload, 'channel'),
    uploader: readString(payload, 'uploader'),
    likeCount: readNumber(payload, 'like_count'),
    durationSeconds: readNumber(payload, 'duration')
  };
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
