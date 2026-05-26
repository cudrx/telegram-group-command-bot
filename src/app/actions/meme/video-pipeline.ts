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

    const filePath = await runWithNormalizationLock(async () => {
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
