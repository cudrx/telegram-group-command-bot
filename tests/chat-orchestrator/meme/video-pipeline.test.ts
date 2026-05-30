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
          options?: { cwd?: string | undefined; maxBuffer?: number | undefined }
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

          if (file === 'ffprobe') {
            expect(args).toContain('-show_entries');
            const probedPath = args.at(-1) ?? '';

            if (probedPath.includes('normalized.mp4')) {
              return {
                stdout: JSON.stringify({
                  format: { duration: '12.20' },
                  streams: [
                    {
                      codec_type: 'video',
                      codec_name: 'h264',
                      width: 720,
                      height: 1280
                    }
                  ]
                }),
                stderr: ''
              };
            }

            expect(probedPath).toContain('source.mp4');
            return {
              stdout: JSON.stringify({
                format: { duration: '12.34' },
                streams: [
                  {
                    codec_type: 'video',
                    codec_name: 'h264',
                    width: 720,
                    height: 1280
                  }
                ]
              }),
              stderr: ''
            };
          }

          expect(file).toBe('nice');
          expect(args).toEqual(
            expect.arrayContaining([
              '-n',
              '19',
              'ffmpeg',
              '-vf',
              "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))':out_range=tv,setsar=1,format=yuv420p",
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
        durationSeconds: 12,
        width: 720,
        height: 1280
      })
    );
    if (result.kind !== 'video') {
      throw new Error('Expected video media.');
    }

    expect(result.filePath).toContain('normalized.mp4');
    const filePath = result.filePath;
    expect(existsSync(filePath)).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(4);

    await result.cleanup();

    expect(existsSync(filePath)).toBe(false);
  });

  test('removes temp files when normalization fails', async () => {
    let tempDirectory = '';
    const execFile = vi.fn().mockImplementation(
      async (
        file: string,
        args: string[],
        _options?: {
          cwd?: string | undefined;
          maxBuffer?: number | undefined;
        }
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

        if (file === 'ffprobe') {
          return {
            stdout: JSON.stringify({ format: { duration: '12' } }),
            stderr: ''
          };
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

  test('rejects downloaded videos longer than the duration cap before ffmpeg', async () => {
    let tempDirectory = '';
    const execFile = vi.fn().mockImplementation(
      async (
        file: string,
        args: string[],
        _options?: {
          cwd?: string | undefined;
          maxBuffer?: number | undefined;
        }
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

        if (file === 'ffprobe') {
          return {
            stdout: JSON.stringify({ format: { duration: '121.5' } }),
            stderr: ''
          };
        }

        throw new Error(`Unexpected command: ${file}`);
      }
    );

    await expect(
      downloadTelegramSafeVideoWithYtDlp({
        execFile,
        url: 'https://example.com/video',
        tempPrefix: 'pipeline-duration-test-',
        maxBytes: 50_000_000,
        maxDurationSeconds: 120,
        ytDlpArgs: []
      })
    ).rejects.toThrow('Media duration is too long: 121.5 seconds.');

    expect(execFile).toHaveBeenCalledTimes(2);
    expect(tempDirectory).not.toBe('');
    expect(existsSync(tempDirectory)).toBe(false);
  });

  test('runs only one normalization at a time', async () => {
    let activeNormalizations = 0;
    let maxActiveNormalizations = 0;
    const execFile = vi
      .fn()
      .mockImplementation(async (file: string, args: string[]) => {
        if (file === 'yt-dlp') {
          const outputTemplate = args[args.indexOf('-o') + 1] ?? '';
          await writeFile(
            path.join(path.dirname(outputTemplate), 'source.mp4'),
            new Uint8Array([1, 2, 3])
          );
          return { stdout: '', stderr: '' };
        }

        if (file === 'ffprobe') {
          return {
            stdout: JSON.stringify({ format: { duration: '10' } }),
            stderr: ''
          };
        }

        expect(file).toBe('nice');
        activeNormalizations += 1;
        maxActiveNormalizations = Math.max(
          maxActiveNormalizations,
          activeNormalizations
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        await writeFile(args.at(-1) ?? '', new Uint8Array([1, 2, 3]));
        activeNormalizations -= 1;

        return { stdout: '', stderr: '' };
      });

    const [first, second] = await Promise.all([
      downloadTelegramSafeVideoWithYtDlp({
        execFile,
        url: 'https://example.com/one',
        tempPrefix: 'pipeline-lock-one-',
        maxBytes: 50_000_000,
        maxDurationSeconds: 120,
        ytDlpArgs: []
      }),
      downloadTelegramSafeVideoWithYtDlp({
        execFile,
        url: 'https://example.com/two',
        tempPrefix: 'pipeline-lock-two-',
        maxBytes: 50_000_000,
        maxDurationSeconds: 120,
        ytDlpArgs: []
      })
    ]);

    expect(maxActiveNormalizations).toBe(1);

    await first.cleanup();
    await second.cleanup();
  });
});
