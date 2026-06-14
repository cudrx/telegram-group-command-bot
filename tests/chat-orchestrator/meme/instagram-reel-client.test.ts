import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import {
  downloadInstagramReelWithYtDlp,
  findInstagramReelUrl,
  formatInstagramReelCaption
} from '../../../src/app/actions/meme/instagram-reel-client.js';

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

describe('findInstagramReelUrl', () => {
  test('extracts Instagram Reel URLs and strips query params', () => {
    expect(
      findInstagramReelUrl(
        'лови https://www.instagram.com/reel/DYKAmhRu8g-/?igsh=abc'
      )
    ).toBe('https://www.instagram.com/reel/DYKAmhRu8g-/');
  });

  test('ignores unsupported Instagram URLs', () => {
    expect(
      findInstagramReelUrl('https://www.instagram.com/bookstasyaa/')
    ).toBeNull();
  });
});

describe('formatInstagramReelCaption', () => {
  test('formats nickname, like count and visible linked Reel URL', () => {
    expect(
      formatInstagramReelCaption({
        nickname: 'bookstasyaa',
        likeCount: 3597,
        reelUrl: 'https://www.instagram.com/reel/DYKAmhRu8g-/'
      })
    ).toBe(
      'inst: bookstasyaa · likes: <a href="https://www.instagram.com/reel/DYKAmhRu8g-/">3597</a>'
    );
  });

  test('formats zero when like count is unavailable upstream', () => {
    expect(
      formatInstagramReelCaption({
        nickname: 'bookstasyaa',
        likeCount: 0,
        reelUrl: 'https://www.instagram.com/reel/DYKAmhRu8g-/'
      })
    ).toBe(
      'inst: bookstasyaa · likes: <a href="https://www.instagram.com/reel/DYKAmhRu8g-/">0</a>'
    );
  });

  test('escapes nickname', () => {
    expect(
      formatInstagramReelCaption({
        nickname: '<book & stasyaa>',
        likeCount: 1,
        reelUrl: 'https://www.instagram.com/reel/DYKAmhRu8g-/'
      })
    ).toBe(
      'inst: &lt;book &amp; stasyaa&gt; · likes: <a href="https://www.instagram.com/reel/DYKAmhRu8g-/">1</a>'
    );
  });
});

describe('downloadInstagramReelWithYtDlp', () => {
  test('downloads an Instagram Reel with cookies and returns caption metadata', async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'insta-data-'));
    const sqlitePath = path.join(dataDirectory, 'bot.sqlite');
    const cookiesPath = path.join(dataDirectory, 'instagram-cookies.txt');
    await writeFile(
      cookiesPath,
      '.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tabc'
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
            expect(args).toContain('--cookies');
            expect(args).toContain(cookiesPath);
            expect(args).toContain(
              'https://www.instagram.com/reel/DYKAmhRu8g-/'
            );

            return {
              stdout: JSON.stringify({
                id: 'DYKAmhRu8g-',
                title: 'Video by bookstasyaa',
                description: 'ОСТАЛОСЬ 3 ДНЯ',
                channel: 'bookstasyaa',
                like_count: 3478,
                duration: 6.8,
                webpage_url: 'https://www.instagram.com/reels/DYKAmhRu8g-/'
              }),
              stderr: ''
            };
          }

          if (file === 'ffprobe') return videoProbeResult();

          if (file === 'nice') return writeNormalizedVideo(args);

          expect(file).toBe('yt-dlp');
          expect(args).toContain('--cookies');
          expect(args).toContain(cookiesPath);
          expect(args).toContain('--merge-output-format');
          expect(args).toContain('mp4');
          expect(args).toContain(
            'bestvideo[protocol=m3u8_native][ext=mp4]+bestaudio[ext=m4a]/bestvideo[protocol^=m3u8][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc1][acodec^=mp4a]/best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best'
          );

          const outputIndex = args.indexOf('-o');
          const outputTemplate = args[outputIndex + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, 'DYKAmhRu8g-.mp4'),
            new Uint8Array([1, 2, 3, 4])
          );

          expect(options?.cwd).toBe(tempDirectory);
          expect(args).toContain('https://www.instagram.com/reel/DYKAmhRu8g-/');
          return { stdout: '', stderr: '' };
        }
      );

    const result = await downloadInstagramReelWithYtDlp({
      text: 'https://www.instagram.com/reel/DYKAmhRu8g-/?igsh=abc',
      sqlitePath,
      maxBytes: 50_000_000,
      captionMaxLength: 1024,
      execFile
    });

    expect(result).toEqual(
      expect.objectContaining({
        caption:
          'inst: bookstasyaa · likes: <a href="https://www.instagram.com/reel/DYKAmhRu8g-/">3478</a>',
        sourceUrl: 'https://www.instagram.com/reel/DYKAmhRu8g-/',
        downloaded: expect.objectContaining({
          kind: 'video',
          extension: 'mp4',
          durationSeconds: 6.8
        })
      })
    );
    if (result?.downloaded.kind !== 'video') {
      throw new Error(
        'Expected Instagram Reel download to return video media.'
      );
    }

    expect(result.downloaded.filePath).toContain('normalized.mp4');

    const filePath = result.downloaded.filePath;
    expect(existsSync(filePath)).toBe(true);

    await result?.downloaded.cleanup();

    expect(existsSync(filePath)).toBe(false);
  });

  test('uses an explicit Instagram cookies path', async () => {
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'insta-explicit-data-')
    );
    const cookiesPath = path.join(
      dataDirectory,
      'custom-instagram-cookies.txt'
    );
    await writeFile(
      cookiesPath,
      '.instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\texplicit'
    );
    const execFile = vi
      .fn()
      .mockImplementation(async (file: string, args: string[]) => {
        if (file === 'yt-dlp' && args.includes('--dump-single-json')) {
          expect(args).toContain('--cookies');
          expect(args).toContain(cookiesPath);
          return {
            stdout: JSON.stringify({
              id: 'DYKAmhRu8g-',
              title: 'Video by bookstasyaa',
              channel: 'bookstasyaa',
              like_count: 1,
              webpage_url: 'https://www.instagram.com/reels/DYKAmhRu8g-/'
            }),
            stderr: ''
          };
        }

        if (file === 'ffprobe') return videoProbeResult();

        if (file === 'nice') return writeNormalizedVideo(args);

        expect(file).toBe('yt-dlp');
        expect(args).toContain('--cookies');
        expect(args).toContain(cookiesPath);

        const outputTemplate = args[args.indexOf('-o') + 1] ?? '';
        await writeFile(
          path.join(path.dirname(outputTemplate), 'DYKAmhRu8g-.mp4'),
          new Uint8Array([1])
        );

        return { stdout: '', stderr: '' };
      });

    const result = await downloadInstagramReelWithYtDlp({
      text: 'https://www.instagram.com/reel/DYKAmhRu8g-/',
      sqlitePath: ':memory:',
      instagramCookiesPath: cookiesPath,
      maxBytes: 50_000_000,
      captionMaxLength: 1024,
      execFile
    });

    await result?.downloaded.cleanup();

    expect(result?.caption).toBe(
      'inst: bookstasyaa · likes: <a href="https://www.instagram.com/reel/DYKAmhRu8g-/">1</a>'
    );
  });

  test('returns null when no Reel URL is present', async () => {
    const execFile = vi.fn();

    await expect(
      downloadInstagramReelWithYtDlp({
        text: 'https://www.instagram.com/bookstasyaa/',
        sqlitePath: '/tmp/bot.sqlite',
        maxBytes: 50_000_000,
        captionMaxLength: 1024,
        execFile
      })
    ).resolves.toBeNull();
    expect(execFile).not.toHaveBeenCalled();
  });
});
