import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { downloadRedditVideoWithYtDlp } from '../../../src/app/actions/meme/yt-dlp-client.js';
import type { MediaExecFile } from '../../../src/media/exec.js';
import { writeRedditPostDump } from './orchestration/support.js';

describe('downloadRedditVideoWithYtDlp', () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([
    { share: false, spoiler: false, over18: false, wantSpoiler: false },
    { share: true, spoiler: false, over18: false, wantSpoiler: false },
    { share: true, spoiler: true, over18: false, wantSpoiler: true },
    { share: true, spoiler: false, over18: true, wantSpoiler: true }
  ])('preserves Reddit flags without HTTP: $share / $spoiler / $over18', async ({
    share,
    spoiler,
    over18,
    wantSpoiler
  }) => {
    const sourceUrl = share
      ? 'https://www.reddit.com/r/ForzaHorizon/s/shareToken'
      : 'https://www.reddit.com/r/ForzaHorizon/comments/1u5ioqp/everyone_really_enjoyed_black_route_so_here_is_a/';
    let metadataDirectory: string | undefined;
    const relativeCookiesPath = 'data/reddit-cookies.txt';
    const expectedCookiesPath = path.resolve(relativeCookiesPath);
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('HTTP must not run'));
    const execFile = vi
      .fn()
      .mockImplementation(
        async (
          file: string,
          args: string[],
          options?: { cwd?: string | undefined; maxBuffer?: number | undefined }
        ) => {
          if (file === 'yt-dlp' && args.includes('--dump-single-json')) {
            metadataDirectory = options?.cwd;
            expect(args).toContain('--write-pages');
            await writeRedditPostDump(metadataDirectory, {
              id: '1u5ioqp',
              spoiler,
              over_18: over18
            });
            expect(args).toContain('--cookies');
            expect(args).toContain(expectedCookiesPath);
            expect(
              args.slice(
                args.indexOf('--impersonate'),
                args.indexOf('--impersonate') + 2
              )
            ).toEqual(['--impersonate', 'chrome']);

            return {
              stdout: JSON.stringify({
                id: 'nativeVideoId',
                display_id: '1u5ioqp',
                channel_id: 'ForzaHorizon',
                webpage_url:
                  'https://www.reddit.com/r/ForzaHorizon/comments/1u5ioqp/everyone_really_enjoyed_black_route_so_here_is_a/',
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
          expect(
            args.slice(
              args.indexOf('--impersonate'),
              args.indexOf('--impersonate') + 2
            )
          ).toEqual(['--impersonate', 'chrome']);

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
      text: sourceUrl,
      sqlitePath: '/tmp/bot.sqlite',
      redditCookiesPath: relativeCookiesPath,
      maxBytes: 50_000_000,
      execFile
    });

    expect(result).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledWith(
      'yt-dlp',
      expect.arrayContaining(['--dump-single-json', sourceUrl]),
      expect.any(Object)
    );
    expect(result?.candidate).toMatchObject({
      redditPostId: '1u5ioqp',
      subreddit: 'ForzaHorizon',
      permalink:
        'https://www.reddit.com/r/ForzaHorizon/comments/1u5ioqp/everyone_really_enjoyed_black_route_so_here_is_a/',
      title: 'Forza track',
      upvotes: 321
    });
    expect(result?.candidate.media.hasSpoiler ?? false).toBe(wantSpoiler);
    expect(metadataDirectory && existsSync(metadataDirectory)).toBe(false);

    if (result?.downloaded.kind !== 'video') {
      throw new Error('Expected Reddit video download result.');
    }

    const filePath = result.downloaded.filePath;
    expect(existsSync(filePath)).toBe(true);

    await result.downloaded.cleanup();

    expect(existsSync(filePath)).toBe(false);
  });

  test('removes saved Reddit responses when metadata extraction fails', async () => {
    let directory: string | undefined;
    const execFile: MediaExecFile = async (_file, _args, options) => {
      directory = options?.cwd;
      await writeRedditPostDump(directory, {
        id: '1u5ioqp',
        spoiler: true,
        over_18: false
      });

      throw new Error('metadata extraction failed');
    };

    await expect(
      downloadRedditVideoWithYtDlp({
        text: 'https://www.reddit.com/r/ForzaHorizon/comments/1u5ioqp/post/',
        sqlitePath: '/tmp/bot.sqlite',
        maxBytes: 50_000_000,
        execFile
      })
    ).rejects.toThrow('metadata extraction failed');
    expect(directory).toBeTruthy();
    expect(directory && existsSync(directory)).toBe(false);
  });

  test('does not download a video when its Reddit flags are missing', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ id: 'nativeVideoId', age_limit: 0 }),
      stderr: ''
    });

    await expect(
      downloadRedditVideoWithYtDlp({
        text: 'https://www.reddit.com/r/ForzaHorizon/comments/1u5ioqp/post/',
        sqlitePath: '/tmp/bot.sqlite',
        maxBytes: 50_000_000,
        execFile
      })
    ).rejects.toThrow('yt-dlp did not save Reddit spoiler metadata');
    expect(execFile).toHaveBeenCalledTimes(1);
  });
});
