import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { redditMediaActionConfig } from '../../../config/runtime/index.js';
import {
  execMediaFileDefault,
  MEDIA_EXEC_MAX_BUFFER,
  type MediaExecFile
} from '../../../media/exec.js';
import type { ProcessStatusReporter } from '../../process-status.js';
import type { DownloadedMemeMedia } from './types.js';

export const DIRECT_VIDEO_MAX_DURATION_SECONDS =
  redditMediaActionConfig.telegramMedia.videoMaxDurationSeconds;
const YT_DLP_BIN = 'yt-dlp';
const NICE_BIN = 'nice';
const FFMPEG_BIN = 'ffmpeg';
const FFPROBE_BIN = 'ffprobe';
const TELEGRAM_SAFE_VIDEO_FILTER =
  "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))':out_range=tv,setsar=1,format=yuv420p";

type VideoProbe = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

export class DirectVideoTooLargeError extends Error {
  readonly actualBytes: number;
  readonly maxBytes: number;

  constructor(actualBytes: number, maxBytes: number) {
    super(`Media file is too large: ${actualBytes} bytes.`);
    this.name = 'DirectVideoTooLargeError';
    this.actualBytes = actualBytes;
    this.maxBytes = maxBytes;
  }
}

export class DirectVideoTooLongError extends Error {
  readonly durationSeconds: number;
  readonly maxDurationSeconds: number;

  constructor(durationSeconds: number, maxDurationSeconds: number) {
    super(`Media duration is too long: ${durationSeconds} seconds.`);
    this.name = 'DirectVideoTooLongError';
    this.durationSeconds = durationSeconds;
    this.maxDurationSeconds = maxDurationSeconds;
  }
}

export function isDirectVideoTooLargeError(
  error: unknown
): error is DirectVideoTooLargeError {
  return error instanceof DirectVideoTooLargeError;
}

export function isDirectVideoTooLongError(
  error: unknown
): error is DirectVideoTooLongError {
  return error instanceof DirectVideoTooLongError;
}

export type DownloadTelegramSafeVideoInput = {
  url: string;
  tempPrefix: string;
  maxBytes: number;
  estimatedDownloadBytes?: number | null | undefined;
  preDownloadRejectBytes?: number | undefined;
  maxDurationSeconds?: number | undefined;
  downloadTimeoutMs?: number | undefined;
  probeTimeoutMs?: number | undefined;
  normalizeTimeoutMs?: number | undefined;
  ytDlpArgs: string[];
  durationSeconds?: number | null;
  processStatus?: ProcessStatusReporter | undefined;
  execFile?: MediaExecFile | undefined;
};

let normalizationQueue: Promise<void> = Promise.resolve();

export async function downloadTelegramSafeVideoWithYtDlp(
  input: DownloadTelegramSafeVideoInput
): Promise<DownloadedMemeMedia> {
  const execFile = input.execFile ?? execMediaFileDefault;
  assertWithinEstimatedMaxBytes({
    estimatedBytes: input.estimatedDownloadBytes,
    rejectBytes:
      input.preDownloadRejectBytes ??
      redditMediaActionConfig.telegramMedia.videoPreDownloadRejectBytes,
    maxBytes: input.maxBytes
  });
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), input.tempPrefix));

  try {
    await input.processStatus?.stage('metadata');
    await input.processStatus?.stage('download');
    const downloadResult = await execFile(
      YT_DLP_BIN,
      [
        ...input.ytDlpArgs,
        '--no-playlist',
        '--max-filesize',
        formatMaxFilesize(input.maxBytes),
        '--merge-output-format',
        'mp4',
        '-o',
        path.join(tempDirectory, '%(id)s.%(ext)s'),
        input.url
      ],
      {
        cwd: tempDirectory,
        timeoutMs:
          input.downloadTimeoutMs ??
          redditMediaActionConfig.telegramMedia.videoDownloadTimeoutMs
      }
    );

    const downloadedPath = await findDownloadedMp4(
      tempDirectory,
      downloadResult
    );
    await assertWithinMaxBytes(downloadedPath, input.maxBytes);
    await input.processStatus?.stage('probe');
    const probe = await probeVideo({
      execFile,
      filePath: downloadedPath,
      cwd: tempDirectory,
      timeoutMs:
        input.probeTimeoutMs ??
        redditMediaActionConfig.telegramMedia.probeTimeoutMs
    });
    assertWithinMaxDuration(probe.durationSeconds, input.maxDurationSeconds);

    const normalizedPath = await runWithNormalizationLock(async () => {
      await input.processStatus?.stage('convert');
      const outputPath = path.join(tempDirectory, 'normalized.mp4');
      await normalizeVideoForTelegram({
        execFile,
        inputPath: downloadedPath,
        outputPath,
        cwd: tempDirectory,
        timeoutMs:
          input.normalizeTimeoutMs ??
          redditMediaActionConfig.telegramMedia.normalizeTimeoutMs
      });
      return outputPath;
    });
    await assertWithinMaxBytes(normalizedPath, input.maxBytes);
    await input.processStatus?.stage('probe');
    const normalizedProbe = await probeVideo({
      execFile,
      filePath: normalizedPath,
      cwd: tempDirectory,
      timeoutMs:
        input.probeTimeoutMs ??
        redditMediaActionConfig.telegramMedia.probeTimeoutMs
    });

    return {
      kind: 'video',
      filePath: normalizedPath,
      extension: 'mp4',
      ...(input.durationSeconds !== undefined
        ? { durationSeconds: input.durationSeconds }
        : {}),
      ...(normalizedProbe.width !== null
        ? { width: normalizedProbe.width }
        : {}),
      ...(normalizedProbe.height !== null
        ? { height: normalizedProbe.height }
        : {}),
      cleanup: async () => {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function probeVideo(input: {
  execFile: MediaExecFile;
  filePath: string;
  cwd: string;
  timeoutMs: number;
}): Promise<VideoProbe> {
  const result = await input.execFile(
    FFPROBE_BIN,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height',
      '-of',
      'json',
      input.filePath
    ],
    {
      cwd: input.cwd,
      maxBuffer: MEDIA_EXEC_MAX_BUFFER,
      timeoutMs: input.timeoutMs
    }
  );
  const payload = JSON.parse(result.stdout) as unknown;

  return {
    durationSeconds: readDurationSeconds(payload),
    ...readVideoDimensions(payload)
  };
}

async function normalizeVideoForTelegram(input: {
  execFile: MediaExecFile;
  inputPath: string;
  outputPath: string;
  cwd: string;
  timeoutMs: number;
}): Promise<void> {
  await input.execFile(
    NICE_BIN,
    [
      '-n',
      '19',
      FFMPEG_BIN,
      '-y',
      '-i',
      input.inputPath,
      '-vf',
      TELEGRAM_SAFE_VIDEO_FILTER,
      '-map_metadata',
      '-1',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-color_range',
      'tv',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      input.outputPath
    ],
    { cwd: input.cwd, timeoutMs: input.timeoutMs }
  );
}

async function runWithNormalizationLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = normalizationQueue;
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  normalizationQueue = previous.then(
    () => current,
    () => current
  );

  try {
    await previous.catch(() => {});
    return await fn();
  } finally {
    release();
  }
}

async function findDownloadedMp4(
  directory: string,
  result: { stdout: string; stderr: string }
): Promise<string> {
  const entries = (await readdir(directory)).sort();
  const mp4 = entries.find((entry) => entry.toLowerCase().endsWith('.mp4'));

  if (!mp4) {
    throw new Error(formatMissingMp4Error(entries, result));
  }

  return path.join(directory, mp4);
}

function formatMissingMp4Error(
  entries: string[],
  result: { stdout: string; stderr: string }
): string {
  const details = [
    `Files: ${entries.length > 0 ? entries.join(', ') : 'none'}`,
    formatOutputDetail('stderr', result.stderr),
    formatOutputDetail('stdout', result.stdout)
  ].filter((detail) => detail.length > 0);

  return `yt-dlp did not produce an mp4 file. ${details.join('. ')}`;
}

function formatOutputDetail(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  return `${label}: ${truncateDiagnostic(trimmed)}`;
}

function truncateDiagnostic(value: string): string {
  const maxLength = 1_000;

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function assertWithinEstimatedMaxBytes(input: {
  estimatedBytes: number | null | undefined;
  rejectBytes: number;
  maxBytes: number;
}): void {
  if (
    input.estimatedBytes !== null &&
    input.estimatedBytes !== undefined &&
    input.estimatedBytes > input.rejectBytes
  ) {
    throw new DirectVideoTooLargeError(input.estimatedBytes, input.maxBytes);
  }
}

async function assertWithinMaxBytes(
  filePath: string,
  maxBytes: number
): Promise<void> {
  const fileStat = await stat(filePath);

  if (fileStat.size > maxBytes) {
    throw new DirectVideoTooLargeError(fileStat.size, maxBytes);
  }
}

function assertWithinMaxDuration(
  durationSeconds: number | null,
  maxDurationSeconds: number | undefined
): void {
  if (
    maxDurationSeconds !== undefined &&
    durationSeconds !== null &&
    durationSeconds > maxDurationSeconds
  ) {
    throw new DirectVideoTooLongError(durationSeconds, maxDurationSeconds);
  }
}

function formatMaxFilesize(maxBytes: number): string {
  return `${Math.floor(maxBytes / 1_000_000)}M`;
}

function readDurationSeconds(value: unknown): number | null {
  if (!isRecord(value)) return null;

  const format = value.format;
  if (!isRecord(format)) return null;

  const duration = format.duration;
  if (typeof duration === 'number' && Number.isFinite(duration)) {
    return duration;
  }

  if (typeof duration !== 'string') return null;

  const parsed = Number(duration);
  return Number.isFinite(parsed) ? parsed : null;
}

function readVideoDimensions(value: unknown): {
  width: number | null;
  height: number | null;
} {
  if (!isRecord(value) || !Array.isArray(value.streams)) {
    return { width: null, height: null };
  }

  const video = value.streams.find(
    (stream): stream is Record<string, unknown> =>
      isRecord(stream) && stream.codec_type === 'video'
  );
  if (!video) return { width: null, height: null };

  return {
    width: readPositiveInteger(video.width),
    height: readPositiveInteger(video.height)
  };
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

export function readYtDlpRequestedDownloadBytes(value: unknown): number | null {
  if (!isRecord(value) || !Array.isArray(value.requested_downloads)) {
    return null;
  }

  let total = 0;
  let found = false;

  for (const download of value.requested_downloads) {
    const formats = isRecord(download) ? download.requested_formats : null;
    if (Array.isArray(formats)) {
      for (const format of formats) {
        const bytes = readFormatBytes(format);
        if (bytes === null) return null;
        total += bytes;
        found = true;
      }
      continue;
    }

    const bytes = readFormatBytes(download);
    if (bytes === null) return null;
    total += bytes;
    found = true;
  }

  return found ? total : null;
}

function readFormatBytes(value: unknown): number | null {
  if (!isRecord(value)) return null;

  const filesize = value.filesize;
  if (typeof filesize === 'number' && Number.isFinite(filesize)) {
    return filesize;
  }

  const approx = value.filesize_approx;
  if (typeof approx === 'number' && Number.isFinite(approx)) {
    return approx;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
