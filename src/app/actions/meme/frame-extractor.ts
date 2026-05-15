import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ExtractedAnimationFrame = {
  filePath: string;
  bytes: number;
  cleanup: () => Promise<void>;
};

export type RunFfmpeg = (args: string[]) => Promise<unknown>;

export type MemeFrameExtractor = (input: {
  inputPath: string;
}) => Promise<ExtractedAnimationFrame>;

export async function extractAnimationFrameToTemp(input: {
  inputPath: string;
  runFfmpeg?: RunFfmpeg;
}): Promise<ExtractedAnimationFrame> {
  const runFfmpeg = input.runFfmpeg ?? runDefaultFfmpeg;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'meme-frame-'));
  const outputPath = path.join(tempDirectory, 'meme-frame.jpg');

  try {
    await tryExtractFrame({
      inputPath: input.inputPath,
      outputPath,
      timestampSeconds: 1,
      runFfmpeg
    });

    const { size } = await stat(outputPath);

    return {
      filePath: outputPath,
      bytes: size,
      cleanup: async () => {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    };
  } catch (firstError) {
    try {
      await tryExtractFrame({
        inputPath: input.inputPath,
        outputPath,
        timestampSeconds: 0,
        runFfmpeg
      });

      const { size } = await stat(outputPath);

      return {
        filePath: outputPath,
        bytes: size,
        cleanup: async () => {
          await rm(tempDirectory, { recursive: true, force: true });
        }
      };
    } catch (fallbackError) {
      await rm(tempDirectory, { recursive: true, force: true });
      throw fallbackError instanceof Error ? fallbackError : firstError;
    }
  }
}

async function tryExtractFrame(input: {
  inputPath: string;
  outputPath: string;
  timestampSeconds: 0 | 1;
  runFfmpeg: RunFfmpeg;
}): Promise<void> {
  await input.runFfmpeg([
    '-y',
    '-ss',
    String(input.timestampSeconds),
    '-i',
    input.inputPath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    input.outputPath
  ]);
}

async function runDefaultFfmpeg(args: string[]): Promise<void> {
  await execFileAsync('ffmpeg', args);
}
