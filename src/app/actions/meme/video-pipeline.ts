import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  execMediaFileDefault,
  MEDIA_EXEC_MAX_BUFFER,
  type MediaExecFile
} from '../../../media/exec.js';
import type { ProcessStatusReporter } from '../../process-status.js';
import type { DownloadedMemeMedia } from './types.js';

export const DIRECT_VIDEO_MAX_DURATION_SECONDS = 120;
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

export type DownloadTelegramSafeVideoInput = {
  url: string;
  tempPrefix: string;
  maxBytes: number;
  maxDurationSeconds?: number | undefined;
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
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), input.tempPrefix));

  try {
    await input.processStatus?.stage('metadata');
    await input.processStatus?.stage('download');
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
    await input.processStatus?.stage('probe');
    const probe = await probeVideo({
      execFile,
      filePath: downloadedPath,
      cwd: tempDirectory
    });
    assertWithinMaxDuration(probe.durationSeconds, input.maxDurationSeconds);

    const normalizedPath = await runWithNormalizationLock(async () => {
      await input.processStatus?.stage('convert');
      const outputPath = path.join(tempDirectory, 'normalized.mp4');
      await normalizeVideoForTelegram({
        execFile,
        inputPath: downloadedPath,
        outputPath,
        cwd: tempDirectory
      });
      return outputPath;
    });
    await assertWithinMaxBytes(normalizedPath, input.maxBytes);
    await input.processStatus?.stage('probe');
    const normalizedProbe = await probeVideo({
      execFile,
      filePath: normalizedPath,
      cwd: tempDirectory
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
    { cwd: input.cwd, maxBuffer: MEDIA_EXEC_MAX_BUFFER }
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

function assertWithinMaxDuration(
  durationSeconds: number | null,
  maxDurationSeconds: number | undefined
): void {
  if (
    maxDurationSeconds !== undefined &&
    durationSeconds !== null &&
    durationSeconds > maxDurationSeconds
  ) {
    throw new Error(`Media duration is too long: ${durationSeconds} seconds.`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
