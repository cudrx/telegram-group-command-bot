import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { DownloadedMemeMedia } from './types.js';
import type { YtDlpExecFile } from './yt-dlp-client.js';

const execFileDefault = promisify(execFileCallback);
const YT_DLP_BIN = 'yt-dlp';

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
  execFile?: YtDlpExecFile | undefined;
}): Promise<InstagramReelDownloadResult | null> {
  const reelUrl = findInstagramReelUrl(input.text);
  if (!reelUrl) return null;

  const execFile = input.execFile ?? execFileDefault;
  const cookiesPath =
    input.instagramCookiesPath ??
    path.join(path.dirname(input.sqlitePath), 'instagram-cookies.txt');
  const metadata = await fetchInstagramMetadata({
    execFile,
    cookiesPath,
    url: reelUrl
  });
  const sourceUrl = metadata.webpageUrl ?? reelUrl;
  const tempDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'instagram-ytdlp-')
  );

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
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '-o',
        path.join(tempDirectory, '%(id)s.%(ext)s'),
        sourceUrl
      ],
      { cwd: tempDirectory }
    );

    const filePath = await findDownloadedMp4(tempDirectory);
    const fileStat = await stat(filePath);

    if (fileStat.size > input.maxBytes) {
      throw new Error(`Media file is too large: ${fileStat.size} bytes.`);
    }

    return {
      caption: formatInstagramReelCaption({
        description: metadata.description,
        title: metadata.title,
        nickname: metadata.channel,
        likeCount: metadata.likeCount,
        reelUrl: sourceUrl,
        maxLength: input.captionMaxLength
      }),
      sourceUrl,
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

export function formatInstagramReelCaption(input: {
  description: string | null;
  title: string | null;
  nickname: string | null;
  likeCount: number | null;
  reelUrl: string;
  maxLength: number;
}): string {
  const name = input.nickname ? `inst:${input.nickname}` : 'inst';
  const likesLabel =
    input.likeCount === null
      ? 'likes:'
      : `likes:${formatInteger(input.likeCount)}`;
  const metadata = `${escapeHtml(name)} · <a href="${escapeAttribute(
    input.reelUrl
  )}">${likesLabel}</a>`;
  const rawTitle = (input.description || input.title || '').trim();
  if (!rawTitle) return metadata;

  const separator = '\n\n';
  const titleBudget = Math.max(
    0,
    input.maxLength - separator.length - metadata.length
  );
  const escapedTitle = truncateAndEscape(rawTitle, titleBudget);

  return `${escapedTitle}${separator}${metadata}`.trim();
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
  execFile: YtDlpExecFile;
  cookiesPath: string;
  url: string;
}): Promise<{
  title: string | null;
  description: string | null;
  channel: string | null;
  likeCount: number | null;
  durationSeconds: number | null;
  webpageUrl: string | null;
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
    title: readString(payload, 'title'),
    description: readString(payload, 'description'),
    channel: readString(payload, 'channel'),
    likeCount: readNumber(payload, 'like_count'),
    durationSeconds: readNumber(payload, 'duration'),
    webpageUrl: readString(payload, 'webpage_url')
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

function isInstagramHost(hostname: string): boolean {
  return hostname === 'instagram.com' || hostname.endsWith('.instagram.com');
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.]+$/u, '');
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

function truncateAndEscape(value: string, maxEscapedLength: number): string {
  const trimmed = value.trim();
  if (escapeHtml(trimmed).length <= maxEscapedLength) {
    return escapeHtml(trimmed);
  }

  if (maxEscapedLength <= 0) {
    return '';
  }

  let truncated = '';
  for (const character of trimmed) {
    const candidate = `${truncated}${character}`;
    const escapedCandidate = escapeHtml(`${candidate.trimEnd()}…`);
    if (escapedCandidate.length > maxEscapedLength) {
      break;
    }

    truncated = candidate;
  }

  if (!truncated && maxEscapedLength >= '…'.length) {
    return '…';
  }

  return escapeHtml(`${truncated.trimEnd()}…`);
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
