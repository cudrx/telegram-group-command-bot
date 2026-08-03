import { redditMediaActionConfig } from '../../../config/runtime/index.js';
import {
  execMediaFileDefault,
  MEDIA_EXEC_MAX_BUFFER,
  type MediaExecFile
} from '../../../media/exec.js';
import type { ProcessStatusReporter } from '../../process-status.js';
import type { DownloadedMemeMedia } from './types.js';
import {
  DIRECT_VIDEO_MAX_DURATION_SECONDS,
  DirectVideoTooLongError,
  downloadTelegramSafeVideoWithYtDlp,
  readYtDlpRequestedDownloadBytes
} from './video-pipeline.js';

const YT_DLP_BIN = 'yt-dlp';
const TIKTOK_FORMAT_SELECTOR =
  'best[ext=mp4][vcodec^=avc1]/best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';

export type TiktokDownloadResult = {
  caption: string;
  sourceUrl: string;
  downloaded: DownloadedMemeMedia;
};

export function findTiktokUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];

  for (const match of matches) {
    const url = parseTiktokUrl(match);
    if (url) return url;
  }

  return null;
}

export async function downloadTiktokWithYtDlp(input: {
  text: string;
  maxBytes: number;
  processStatus?: ProcessStatusReporter | undefined;
  execFile?: MediaExecFile | undefined;
}): Promise<TiktokDownloadResult | null> {
  const sourceUrl = findTiktokUrl(input.text);
  if (!sourceUrl) return null;

  const execFile = input.execFile ?? execMediaFileDefault;
  await input.processStatus?.stage('metadata');
  const metadata = await fetchTiktokMetadata({ execFile, url: sourceUrl });
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
    url: sourceUrl,
    tempPrefix: 'tiktok-ytdlp-',
    maxBytes: input.maxBytes,
    estimatedDownloadBytes: metadata.estimatedDownloadBytes,
    maxDurationSeconds: DIRECT_VIDEO_MAX_DURATION_SECONDS,
    durationSeconds: metadata.durationSeconds,
    ...(input.processStatus ? { processStatus: input.processStatus } : {}),
    ytDlpArgs: ['-f', TIKTOK_FORMAT_SELECTOR]
  });

  return {
    caption: formatTiktokCaption({
      creator: metadata.channel ?? metadata.uploader ?? 'unknown',
      likeCount: metadata.likeCount ?? 0,
      sourceUrl
    }),
    sourceUrl,
    downloaded
  };
}

export function formatTiktokCaption(input: {
  creator: string;
  likeCount: number;
  sourceUrl: string;
}): string {
  const name = `tt: ${input.creator}`;
  const metadata = `likes: <a href="${escapeAttribute(input.sourceUrl)}">${formatInteger(input.likeCount)}</a>`;

  return `${escapeHtml(name)} · ${metadata}`;
}

function parseTiktokUrl(value: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(value.replace(/[),.]+$/u, ''));
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'vm.tiktok.com' || hostname === 'vt.tiktok.com') {
    return parsed.pathname === '/' ? null : parsed.toString();
  }

  if (hostname !== 'tiktok.com' && !hostname.endsWith('.tiktok.com')) {
    return null;
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  const videoIndex = parts.findIndex((part) => part.toLowerCase() === 'video');
  if (videoIndex < 1 || !parts[videoIndex + 1]) return null;

  parsed.hash = '';
  return parsed.toString();
}

async function fetchTiktokMetadata(input: {
  execFile: MediaExecFile;
  url: string;
}): Promise<{
  channel: string | null;
  uploader: string | null;
  likeCount: number | null;
  durationSeconds: number | null;
  estimatedDownloadBytes: number | null;
}> {
  const result = await input.execFile(
    YT_DLP_BIN,
    [
      '-f',
      TIKTOK_FORMAT_SELECTOR,
      '--dump-single-json',
      '--no-playlist',
      input.url
    ],
    {
      maxBuffer: MEDIA_EXEC_MAX_BUFFER,
      timeoutMs: redditMediaActionConfig.telegramMedia.metadataTimeoutMs
    }
  );
  const payload = JSON.parse(result.stdout) as unknown;

  return {
    channel: readString(payload, 'channel'),
    uploader: readString(payload, 'uploader'),
    likeCount: readNumber(payload, 'like_count'),
    durationSeconds: readNumber(payload, 'duration'),
    estimatedDownloadBytes: readYtDlpRequestedDownloadBytes(payload)
  };
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
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

  return typeof field === 'string' && field.trim() ? field.trim() : null;
}

function readNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const field = value[key];

  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
