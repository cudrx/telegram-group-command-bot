import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import {
  type DirectVideoTooLargeError,
  DirectVideoTooLongError
} from '../../../src/app/actions/meme/video-pipeline.js';
import {
  downloadYoutubeShortWithYtDlp,
  findYoutubeShortUrl,
  formatYoutubeShortCaption
} from '../../../src/app/actions/meme/youtube-short-client.js';

async function writeNormalizedVideo(args: string[]): Promise<{
  stdout: string;
  stderr: string;
}> {
  const outputPath = args.at(-1) ?? '';
  expect(args).toContain('-vf');
  expect(args).toContain('libx264');
  expect(args).toContain('yuv420p');
  await writeFile(outputPath, new Uint8Array([1, 2, 3]));
  return { stdout: '', stderr: '' };
}

function videoProbeResult(duration = 12): { stdout: string; stderr: string } {
  return {
    stdout: JSON.stringify({ format: { duration: String(duration) } }),
    stderr: ''
  };
}

describe('findYoutubeShortUrl', () => {
  test('normalizes supported YouTube URL formats', () => {
    expect(findYoutubeShortUrl('https://youtu.be/5sMdQW_YYOo')).toBe(
      'https://www.youtube.com/shorts/5sMdQW_YYOo'
    );
    expect(
      findYoutubeShortUrl('https://www.youtube.com/watch?v=5sMdQW_YYOo&t=1')
    ).toBe('https://www.youtube.com/shorts/5sMdQW_YYOo');
    expect(
      findYoutubeShortUrl(
        'https://www.youtube.com/shorts/5sMdQW_YYOo?feature=share'
      )
    ).toBe('https://www.youtube.com/shorts/5sMdQW_YYOo');
  });

  test('ignores unsupported YouTube URLs', () => {
    expect(findYoutubeShortUrl('https://www.youtube.com/@cartaxi')).toBeNull();
  });
});

describe('formatYoutubeShortCaption', () => {
  test('formats channel, like count and linked Short URL like Reels', () => {
    expect(
      formatYoutubeShortCaption({
        channel: 'CarTaxi',
        likeCount: 1234,
        shortUrl: 'https://www.youtube.com/shorts/5sMdQW_YYOo'
      })
    ).toBe(
      'yt: CarTaxi · likes: <a href="https://www.youtube.com/shorts/5sMdQW_YYOo">1234</a>'
    );
  });

  test('escapes channel and defaults missing likes to zero upstream', () => {
    expect(
      formatYoutubeShortCaption({
        channel: '<Car & Taxi>',
        likeCount: 0,
        shortUrl: 'https://www.youtube.com/shorts/5sMdQW_YYOo'
      })
    ).toBe(
      'yt: &lt;Car &amp; Taxi&gt; · likes: <a href="https://www.youtube.com/shorts/5sMdQW_YYOo">0</a>'
    );
  });
});

describe('downloadYoutubeShortWithYtDlp', () => {
  test('downloads a YouTube Short with cookies and returns caption metadata', async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'yt-data-'));
    const sqlitePath = path.join(dataDirectory, 'bot.sqlite');
    const cookiesPath = path.join(dataDirectory, 'youtube-cookies.txt');
    await writeFile(
      cookiesPath,
      '.youtube.com\tTRUE\t/\tTRUE\t0\tVISITOR_INFO1_LIVE\tabc'
    );
    const execFile = vi
      .fn()
      .mockImplementation(
        async (
          file: string,
          args: string[],
          options?: { cwd?: string | undefined; maxBuffer?: number | undefined }
        ) => {
          if (file === 'yt-dlp' && args.includes('--dump-single-json')) {
            expect(options?.maxBuffer).toBeGreaterThan(1024 * 1024);
            expect(args).toContain('--js-runtimes');
            expect(args).toContain('node');
            expect(args).toContain('--cookies');
            expect(args).toContain(cookiesPath);
            expect(args).toContain(
              'https://www.youtube.com/shorts/5sMdQW_YYOo'
            );

            return {
              stdout: JSON.stringify({
                id: '5sMdQW_YYOo',
                title: 'Short title',
                channel: 'cartaxi',
                like_count: 9876,
                duration: 12,
                webpage_url: 'https://www.youtube.com/watch?v=5sMdQW_YYOo'
              }),
              stderr: ''
            };
          }

          if (file === 'ffprobe') return videoProbeResult();

          if (file === 'nice') return writeNormalizedVideo(args);

          expect(file).toBe('yt-dlp');
          expect(args).toContain('--js-runtimes');
          expect(args).toContain('node');
          expect(args).toContain('--cookies');
          expect(args).toContain(cookiesPath);
          expect(args).toContain('--merge-output-format');
          expect(args).toContain('mp4');
          expect(args).toContain(
            'bv*[ext=mp4][vcodec^=avc1][height<=854]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1][height<=854]/b[ext=mp4][height<=854]/b[ext=mp4]'
          );
          expect(args).toContain('-S');
          expect(args).toContain('vcodec:h264,res,ext:mp4:m4a');

          const outputIndex = args.indexOf('-o');
          const outputTemplate = args[outputIndex + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, '5sMdQW_YYOo.mp4'),
            new Uint8Array([1, 2, 3, 4])
          );

          expect(options?.cwd).toBe(tempDirectory);
          expect(args).toContain('https://www.youtube.com/shorts/5sMdQW_YYOo');
          return { stdout: '', stderr: '' };
        }
      );

    const result = await downloadYoutubeShortWithYtDlp({
      text: 'https://youtu.be/5sMdQW_YYOo',
      sqlitePath,
      maxBytes: 50_000_000,
      captionMaxLength: 1024,
      execFile
    });

    expect(result).toEqual(
      expect.objectContaining({
        caption:
          'yt: cartaxi · likes: <a href="https://www.youtube.com/shorts/5sMdQW_YYOo">9876</a>',
        sourceUrl: 'https://www.youtube.com/shorts/5sMdQW_YYOo',
        downloaded: expect.objectContaining({
          kind: 'video',
          extension: 'mp4',
          durationSeconds: 12
        })
      })
    );
    if (result?.downloaded.kind !== 'video') {
      throw new Error('Expected YouTube Short download to return video media.');
    }

    expect(result.downloaded.filePath).toContain('normalized.mp4');
    const filePath = result.downloaded.filePath;
    expect(existsSync(filePath)).toBe(true);

    await result.downloaded.cleanup();

    expect(existsSync(filePath)).toBe(false);
  });

  test('rejects Shorts longer than the duration cap before downloading', async () => {
    const execFile = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify({
        id: 'RsEXmvAefDg',
        channel: 'Lunchb0xGaming',
        like_count: 5035,
        duration: 601
      }),
      stderr: ''
    });

    await expect(
      downloadYoutubeShortWithYtDlp({
        text: 'https://www.youtube.com/shorts/RsEXmvAefDg',
        sqlitePath: '/tmp/bot.sqlite',
        maxBytes: 50_000_000,
        captionMaxLength: 1024,
        execFile
      })
    ).rejects.toBeInstanceOf(DirectVideoTooLongError);

    expect(execFile).toHaveBeenCalledTimes(1);
  });

  test('rejects clearly oversized Shorts before downloading', async () => {
    const execFile = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify({
        id: 'RsEXmvAefDg',
        channel: 'Lunchb0xGaming',
        like_count: 5035,
        duration: 120,
        requested_downloads: [
          {
            requested_formats: [
              { filesize: 60_000_000 },
              { filesize_approx: 16_000_000 }
            ]
          }
        ]
      }),
      stderr: ''
    });

    await expect(
      downloadYoutubeShortWithYtDlp({
        text: 'https://www.youtube.com/shorts/RsEXmvAefDg',
        sqlitePath: '/tmp/bot.sqlite',
        maxBytes: 50_000_000,
        captionMaxLength: 1024,
        execFile
      })
    ).rejects.toMatchObject({
      name: 'DirectVideoTooLargeError',
      actualBytes: 76_000_000,
      maxBytes: 50_000_000
    } satisfies Partial<DirectVideoTooLargeError>);

    expect(execFile).toHaveBeenCalledTimes(1);
    const metadataArgs = execFile.mock.calls[0]?.[1] as string[];
    expect(metadataArgs).toContain('-f');
    expect(metadataArgs).toContain(
      'bv*[ext=mp4][vcodec^=avc1][height<=854]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1][height<=854]/b[ext=mp4][height<=854]/b[ext=mp4]'
    );
  });

  test('returns null when no supported YouTube URL is present', async () => {
    const execFile = vi.fn();

    await expect(
      downloadYoutubeShortWithYtDlp({
        text: 'https://www.youtube.com/@cartaxi',
        sqlitePath: '/tmp/bot.sqlite',
        maxBytes: 50_000_000,
        captionMaxLength: 1024,
        execFile
      })
    ).resolves.toBeNull();
    expect(execFile).not.toHaveBeenCalled();
  });
});
