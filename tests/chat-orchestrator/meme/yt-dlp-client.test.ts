import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import { downloadRedditVideoWithYtDlp } from '../../../src/app/actions/meme/yt-dlp-client.js';

describe('downloadRedditVideoWithYtDlp', () => {
  test('resolves a relative Reddit cookies path before yt-dlp download runs in a temp cwd', async () => {
    const relativeCookiesPath = 'data/reddit-cookies.txt';
    const expectedCookiesPath = path.resolve(relativeCookiesPath);
    const execFile = vi
      .fn()
      .mockImplementation(
        async (
          file: string,
          args: string[],
          options?: { cwd?: string | undefined; maxBuffer?: number | undefined }
        ) => {
          if (file === 'yt-dlp' && args.includes('--dump-single-json')) {
            expect(args).toContain('--cookies');
            expect(args).toContain(expectedCookiesPath);

            return {
              stdout: JSON.stringify({
                id: '1u5ioqp',
                title: 'Forza track',
                like_count: 321,
                duration: 42
              }),
              stderr: ''
            };
          }

          if (file === 'ffprobe') {
            return {
              stdout: JSON.stringify({
                format: { duration: '42' },
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

          if (file === 'nice') {
            const outputPath = args.at(-1) ?? '';
            await writeFile(outputPath, new Uint8Array([1, 2, 3]));
            return { stdout: '', stderr: '' };
          }

          expect(file).toBe('yt-dlp');
          expect(args).toContain('--cookies');
          expect(args).toContain(expectedCookiesPath);

          const outputTemplate = args[args.indexOf('-o') + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, '1u5ioqp.mp4'),
            new Uint8Array([1, 2, 3, 4])
          );
          expect(options?.cwd).toBe(tempDirectory);

          return { stdout: '', stderr: '' };
        }
      );

    const result = await downloadRedditVideoWithYtDlp({
      text: 'https://www.reddit.com/r/ForzaHorizon/comments/1u5ioqp/everyone_really_enjoyed_black_route_so_here_is_a/',
      sqlitePath: '/tmp/bot.sqlite',
      redditCookiesPath: relativeCookiesPath,
      maxBytes: 50_000_000,
      execFile
    });

    expect(result).not.toBeNull();
    expect(execFile).toHaveBeenCalled();

    if (!result || result.downloaded.kind !== 'video') {
      throw new Error('Expected Reddit video download result.');
    }

    const filePath = result.downloaded.filePath;
    expect(existsSync(filePath)).toBe(true);

    await result.downloaded.cleanup();

    expect(existsSync(filePath)).toBe(false);
  });
});
