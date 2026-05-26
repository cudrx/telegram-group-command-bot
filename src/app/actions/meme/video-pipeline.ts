import {
  type ExecFileOptions,
  execFile as execFileCallback
} from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { DownloadedMemeMedia } from './types.js';

export const MEDIA_EXEC_MAX_BUFFER = 64 * 1024 * 1024;
const YT_DLP_BIN = 'yt-dlp';
const NICE_BIN = 'nice';
const FFMPEG_BIN = 'ffmpeg';
const FFPROBE_BIN = 'ffprobe';
const TELEGRAM_SAFE_VIDEO_FILTER =
  "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))':out_range=tv,setsar=1,format=yuv420p";

export type MediaExecFile = (
  file: string,
  args: string[],
  options?: { cwd?: string | undefined; maxBuffer?: number | undefined }
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFileCallback);

export const execMediaFileDefault: MediaExecFile = async (
  file,
  args,
  options
) => {
  const result = await execFileAsync(file, args, {
    ...options,
    maxBuffer: options?.maxBuffer ?? MEDIA_EXEC_MAX_BUFFER
  } satisfies ExecFileOptions);

  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
};

export type DownloadTelegramSafeVideoInput = {
  url: string;
  tempPrefix: string;
  maxBytes: number;
  ytDlpArgs: string[];
  durationSeconds?: number | null;
  execFile?: MediaExecFile | undefined;
};

let normalizationQueue: Promise<void> = Promise.resolve();

export async function downloadTelegramSafeVideoWithYtDlp(
  input: DownloadTelegramSafeVideoInput
): Promise<DownloadedMemeMedia> {
  const execFile = input.execFile ?? execMediaFileDefault;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), input.tempPrefix));

  try {
    await execFile(
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
      { cwd: tempDirectory }
    );

    const downloadedPath = await findDownloadedMp4(tempDirectory);
    await assertWithinMaxBytes(downloadedPath, input.maxBytes);

    const safeVideo = await isTelegramSafeVideo({
      execFile,
      filePath: downloadedPath,
      cwd: tempDirectory
    });
    const filePath = safeVideo
      ? downloadedPath
      : await runWithNormalizationLock(async () => {
          const normalizedPath = path.join(tempDirectory, 'normalized.mp4');
          await normalizeVideoForTelegram({
            execFile,
            inputPath: downloadedPath,
            outputPath: normalizedPath,
            cwd: tempDirectory
          });
          await assertWithinMaxBytes(normalizedPath, input.maxBytes);
          return normalizedPath;
        });

    return {
      kind: 'video',
      filePath,
      extension: 'mp4',
      ...(input.durationSeconds !== undefined
        ? { durationSeconds: input.durationSeconds }
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

async function isTelegramSafeVideo(input: {
  execFile: MediaExecFile;
  filePath: string;
  cwd: string;
}): Promise<boolean> {
  try {
    const result = await input.execFile(
      FFPROBE_BIN,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height,sample_aspect_ratio,display_aspect_ratio,pix_fmt:stream_tags=rotate:side_data=rotation',
        '-of',
        'json',
        input.filePath
      ],
      { cwd: input.cwd, maxBuffer: MEDIA_EXEC_MAX_BUFFER }
    );
    const payload = JSON.parse(result.stdout) as unknown;
    const stream = readFirstStream(payload);

    if (!stream) return false;

    const width = readNumber(stream, 'width');
    const height = readNumber(stream, 'height');
    const rotation = readRotation(stream);

    return (
      readString(stream, 'codec_name') === 'h264' &&
      readString(stream, 'pix_fmt') === 'yuv420p' &&
      readString(stream, 'sample_aspect_ratio') === '1:1' &&
      hasDisplayAspectRatio(readString(stream, 'display_aspect_ratio')) &&
      typeof width === 'number' &&
      width % 2 === 0 &&
      typeof height === 'number' &&
      height % 2 === 0 &&
      !rotation
    );
  } catch {
    return false;
  }
}

async function normalizeVideoForTelegram(input: {
  execFile: MediaExecFile;
  inputPath: string;
  outputPath: string;
  cwd: string;
}): Promise<void> {
  await input.execFile(
    NICE_BIN,
    [
      '-n',
      '10',
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
    { cwd: input.cwd }
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

async function findDownloadedMp4(directory: string): Promise<string> {
  const entries = await readdir(directory);
  const mp4 = entries.find((entry) => entry.toLowerCase().endsWith('.mp4'));

  if (!mp4) {
    throw new Error('yt-dlp did not produce an mp4 file.');
  }

  return path.join(directory, mp4);
}

async function assertWithinMaxBytes(
  filePath: string,
  maxBytes: number
): Promise<void> {
  const fileStat = await stat(filePath);

  if (fileStat.size > maxBytes) {
    throw new Error(`Media file is too large: ${fileStat.size} bytes.`);
  }
}

function formatMaxFilesize(maxBytes: number): string {
  return `${Math.floor(maxBytes / 1_000_000)}M`;
}

function readFirstStream(value: unknown): Record<string, unknown> | null {
  const streams = readArray(value, 'streams');
  const first = streams?.[0];

  return isRecord(first) ? first : null;
}

function readArray(value: unknown, key: string): unknown[] | null {
  if (!isRecord(value)) return null;

  const field = value[key];
  return Array.isArray(field) ? field : null;
}

function readRecord(
  value: unknown,
  key: string
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;

  const field = value[key];
  return isRecord(field) ? field : null;
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

function hasDisplayAspectRatio(value: string | null): boolean {
  return Boolean(value && value !== 'N/A' && value !== '0:1');
}

function readRotation(stream: Record<string, unknown>): string | null {
  const directRotation =
    readString(stream, 'rotation') ??
    readString(readRecord(stream, 'tags'), 'rotate');

  if (directRotation) return directRotation;

  const sideData = readArray(stream, 'side_data_list') ?? [];

  for (const item of sideData) {
    const rotation = readString(item, 'rotation');
    if (rotation) return rotation;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
