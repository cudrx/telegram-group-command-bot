import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import { downloadTelegramSafeVideoWithYtDlp } from '../../../src/app/actions/meme/video-pipeline.js';

describe('downloadTelegramSafeVideoWithYtDlp', () => {
  test('downloads with yt-dlp, normalizes with ffmpeg and cleans temp files', async () => {
    const execFile = vi
      .fn()
      .mockImplementation(
        async (
          file: string,
          args: string[],
          options?: { cwd?: string | undefined }
        ) => {
          if (file === 'yt-dlp') {
            expect(args).toEqual(
              expect.arrayContaining([
                '--cookies',
                '/tmp/cookies.txt',
                '-f',
                'best',
                '--no-playlist',
                '--max-filesize',
                '50M',
                '--merge-output-format',
                'mp4'
              ])
            );
            expect(args.at(-1)).toBe('https://example.com/video');

            const outputTemplate = args[args.indexOf('-o') + 1] ?? '';
            const tempDirectory = path.dirname(outputTemplate);
            await writeFile(
              path.join(tempDirectory, 'source.mp4'),
              new Uint8Array([1, 2, 3, 4])
            );
            expect(options?.cwd).toBe(tempDirectory);

            return { stdout: '', stderr: '' };
          }

          expect(file).toBe('ffmpeg');
          expect(args).toEqual(
            expect.arrayContaining([
              '-vf',
              "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))':out_range=tv,setsar=1,format=yuv420p",
              '-map_metadata',
              '-1',
              '-c:v',
              'libx264',
              '-pix_fmt',
              'yuv420p',
              '-color_range',
              'tv',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-movflags',
              '+faststart'
            ])
          );

          const inputPath = args[args.indexOf('-i') + 1] ?? '';
          const outputPath = args.at(-1) ?? '';
          expect(inputPath).toContain('source.mp4');
          await writeFile(outputPath, new Uint8Array([1, 2, 3]));
          expect(options?.cwd).toBe(path.dirname(outputPath));

          return { stdout: '', stderr: '' };
        }
      );

    const result = await downloadTelegramSafeVideoWithYtDlp({
      execFile,
      url: 'https://example.com/video',
      tempPrefix: 'pipeline-test-',
      maxBytes: 50_000_000,
      durationSeconds: 12,
      ytDlpArgs: ['--cookies', '/tmp/cookies.txt', '-f', 'best']
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'video',
        extension: 'mp4',
        durationSeconds: 12
      })
    );
    if (result.kind !== 'video') {
      throw new Error('Expected video media.');
    }

    expect(result.filePath).toContain('normalized.mp4');
    const filePath = result.filePath;
    expect(existsSync(filePath)).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(2);

    await result.cleanup();

    expect(existsSync(filePath)).toBe(false);
  });

  test('removes temp files when normalization fails', async () => {
    let tempDirectory = '';
    const execFile = vi
      .fn()
      .mockImplementation(
        async (
          file: string,
          args: string[],
          _options?: { cwd?: string | undefined }
        ) => {
          if (file === 'yt-dlp') {
            const outputTemplate = args[args.indexOf('-o') + 1] ?? '';
            tempDirectory = path.dirname(outputTemplate);
            await writeFile(
              path.join(tempDirectory, 'source.mp4'),
              new Uint8Array([1])
            );
            return { stdout: '', stderr: '' };
          }

          throw new Error('ffmpeg failed');
        }
      );

    await expect(
      downloadTelegramSafeVideoWithYtDlp({
        execFile,
        url: 'https://example.com/video',
        tempPrefix: 'pipeline-fail-test-',
        maxBytes: 50_000_000,
        ytDlpArgs: []
      })
    ).rejects.toThrow('ffmpeg failed');

    expect(tempDirectory).not.toBe('');
    expect(existsSync(tempDirectory)).toBe(false);
  });
});
