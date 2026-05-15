import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

import { describe, expect, test, vi } from 'vitest';

import { extractAnimationFrameToTemp } from '../../../src/app/actions/meme/frame-extractor.js';

describe('meme animation frame extractor', () => {
  test('extracts a jpeg frame around one second into the animation', async () => {
    const runFfmpeg = vi.fn().mockImplementation(async (_args: string[]) => {
      const outputPath = _args.at(-1);

      if (!outputPath) throw new Error('missing output path');

      await writeFile(outputPath, new Uint8Array([1, 2, 3]));
    });

    const frame = await extractAnimationFrameToTemp({
      inputPath: '/tmp/meme.gif',
      runFfmpeg
    });

    expect(runFfmpeg).toHaveBeenCalledWith([
      '-y',
      '-ss',
      '1',
      '-i',
      '/tmp/meme.gif',
      '-frames:v',
      '1',
      '-q:v',
      '2',
      expect.stringMatching(/meme-frame\.jpg$/)
    ]);
    expect(frame.bytes).toBe(3);
    expect(existsSync(frame.filePath)).toBe(true);

    await frame.cleanup();
    expect(existsSync(frame.filePath)).toBe(false);
  });

  test('falls back to the first frame when one-second extraction fails', async () => {
    const runFfmpeg = vi
      .fn()
      .mockRejectedValueOnce(new Error('too short'))
      .mockImplementationOnce(async (_args: string[]) => {
        const outputPath = _args.at(-1);

        if (!outputPath) throw new Error('missing output path');

        await writeFile(outputPath, new Uint8Array([4, 5]));
      });

    const frame = await extractAnimationFrameToTemp({
      inputPath: '/tmp/short.mp4',
      runFfmpeg
    });

    expect(runFfmpeg).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining(['-ss', '0'])
    );
    expect(frame.bytes).toBe(2);

    await frame.cleanup();
  });
});
