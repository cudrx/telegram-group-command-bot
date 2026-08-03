import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import {
  downloadTiktokWithYtDlp,
  findTiktokUrl,
  formatTiktokCaption
} from '../../../src/app/actions/meme/tiktok-client.js';

describe('findTiktokUrl', () => {
  test('accepts canonical and short TikTok links and strips punctuation', () => {
    expect(
      findTiktokUrl(
        'смотри https://www.tiktok.com/@creator/video/7512345678901234567?is_from_webapp=1'
      )
    ).toBe(
      'https://www.tiktok.com/@creator/video/7512345678901234567?is_from_webapp=1'
    );
    expect(findTiktokUrl('https://vm.tiktok.com/ZMexample/).')).toBe(
      'https://vm.tiktok.com/ZMexample/'
    );
  });

  test('ignores profiles and non-TikTok links', () => {
    expect(findTiktokUrl('https://www.tiktok.com/@creator')).toBeNull();
    expect(findTiktokUrl('https://example.com/video/123')).toBeNull();
  });
});

describe('formatTiktokCaption', () => {
  test('formats escaped creator and linked like count', () => {
    expect(
      formatTiktokCaption({
        creator: '<creator & co>',
        likeCount: 1234,
        sourceUrl: 'https://www.tiktok.com/@creator/video/7512345678901234567'
      })
    ).toBe(
      'tt: &lt;creator &amp; co&gt; · likes: <a href="https://www.tiktok.com/@creator/video/7512345678901234567">1234</a>'
    );
  });
});

describe('downloadTiktokWithYtDlp', () => {
  test('downloads and normalizes a TikTok video with metadata', async () => {
    const sourceUrl =
      'https://www.tiktok.com/@creator/video/7512345678901234567';
    const execFile = vi
      .fn()
      .mockImplementation(
        async (
          file: string,
          args: string[],
          options?: { cwd?: string | undefined }
        ) => {
          if (file === 'yt-dlp' && args.includes('--dump-single-json')) {
            expect(args).toContain('--no-playlist');
            expect(args).toContain(sourceUrl);
            return {
              stdout: JSON.stringify({
                id: '7512345678901234567',
                uploader: 'creator',
                like_count: 4321,
                duration: 14
              }),
              stderr: ''
            };
          }

          if (file === 'ffprobe') {
            return {
              stdout: JSON.stringify({
                format: { duration: '14' },
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
          expect(args).toContain('--merge-output-format');
          expect(args).toContain('mp4');
          expect(args).toContain(sourceUrl);
          const outputTemplate = args[args.indexOf('-o') + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, '7512345678901234567.mp4'),
            new Uint8Array([1, 2, 3, 4])
          );
          expect(options?.cwd).toBe(tempDirectory);
          return { stdout: '', stderr: '' };
        }
      );

    const result = await downloadTiktokWithYtDlp({
      text: sourceUrl,
      maxBytes: 50_000_000,
      execFile
    });

    expect(result).toEqual(
      expect.objectContaining({
        sourceUrl,
        caption:
          'tt: creator · likes: <a href="https://www.tiktok.com/@creator/video/7512345678901234567">4321</a>',
        downloaded: expect.objectContaining({
          kind: 'video',
          durationSeconds: 14
        })
      })
    );
    if (result?.downloaded.kind !== 'video') {
      throw new Error('Expected TikTok download to return video media.');
    }

    const filePath = result.downloaded.filePath;
    expect(existsSync(filePath)).toBe(true);
    await result?.downloaded.cleanup();
    expect(existsSync(filePath)).toBe(false);
  });
});
