import { describe, expect, test, vi } from 'vitest';

import {
  resolveInstagramGalleryWithGalleryDl,
  resolveTiktokGalleryWithGalleryDl
} from '../../../src/app/actions/meme/gallery-dl-client.js';

describe('resolveInstagramGalleryWithGalleryDl', () => {
  test('resolves ordered Instagram image rows with cookies', async () => {
    const sourceUrl = 'https://www.instagram.com/p/DaBUYYOjNgA/';
    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([
        [2, { category: 'instagram' }],
        [
          3,
          'https://cdn.example/second.webp',
          {
            extension: 'webp',
            num: 2,
            username: 'creator',
            likes: 990
          }
        ],
        [
          3,
          'https://cdn.example/first.webp',
          {
            extension: 'webp',
            num: 1,
            username: 'creator',
            likes: 990
          }
        ]
      ]),
      stderr: ''
    });

    const result = await resolveInstagramGalleryWithGalleryDl({
      text: `${sourceUrl}?igsh=abc`,
      sqlitePath: '/data/bot.sqlite',
      instagramCookiesPath: '/data/instagram-cookies.txt',
      execFile
    });

    expect(execFile).toHaveBeenCalledWith(
      'gallery-dl',
      expect.arrayContaining([
        '--cookies',
        '/data/instagram-cookies.txt',
        '--resolve-json',
        sourceUrl
      ]),
      expect.any(Object)
    );
    expect(result).toEqual({
      sourceUrl,
      caption:
        'inst: creator · likes: <a href="https://www.instagram.com/p/DaBUYYOjNgA/">990</a>',
      media: {
        kind: 'gallery',
        items: [
          { mediaUrl: 'https://cdn.example/first.webp', extension: 'webp' },
          { mediaUrl: 'https://cdn.example/second.webp', extension: 'webp' }
        ]
      }
    });
  });

  test('returns image media for a single-photo post', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([
        [2, { category: 'instagram' }],
        [
          3,
          'https://cdn.example/photo.jpg',
          { extension: 'jpg', num: 1, username: 'creator', likes: 1 }
        ]
      ]),
      stderr: ''
    });

    const result = await resolveInstagramGalleryWithGalleryDl({
      text: 'https://www.instagram.com/p/single/',
      sqlitePath: '/data/bot.sqlite',
      execFile
    });

    expect(result?.media).toEqual({
      kind: 'image',
      mediaUrl: 'https://cdn.example/photo.jpg',
      extension: 'jpg'
    });
  });

  test('rejects mixed Instagram image and video carousels', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([
        [2, { category: 'instagram' }],
        [3, 'https://cdn.example/photo.jpg', { extension: 'jpg', num: 1 }],
        [3, 'https://cdn.example/video.mp4', { extension: 'mp4', num: 2 }]
      ]),
      stderr: ''
    });

    await expect(
      resolveInstagramGalleryWithGalleryDl({
        text: 'https://www.instagram.com/p/mixed/',
        sqlitePath: '/data/bot.sqlite',
        execFile
      })
    ).resolves.toBeNull();
  });
});

describe('resolveTiktokGalleryWithGalleryDl', () => {
  test('keeps ordered photos and excludes the Photo Mode soundtrack', async () => {
    const sourceUrl =
      'https://www.tiktok.com/@creator/photo/7579672560401452311';
    const metadata = {
      author: { uniqueId: 'creator' },
      stats: { diggCount: 62_000 }
    };
    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([
        [2, { category: 'tiktok' }],
        [
          3,
          'https://cdn.example/photo-1.jpeg',
          { ...metadata, extension: 'jpeg', num: 1 }
        ],
        [
          3,
          'https://cdn.example/sound.mp3',
          { ...metadata, extension: 'mp3', num: 0 }
        ],
        [
          3,
          'https://cdn.example/photo-2.jpeg',
          { ...metadata, extension: 'jpeg', num: 2 }
        ]
      ]),
      stderr: ''
    });

    const result = await resolveTiktokGalleryWithGalleryDl({
      text: sourceUrl,
      execFile
    });

    expect(result).toEqual({
      sourceUrl,
      caption:
        'tt: creator · likes: <a href="https://www.tiktok.com/@creator/photo/7579672560401452311">62000</a>',
      media: {
        kind: 'gallery',
        items: [
          { mediaUrl: 'https://cdn.example/photo-1.jpeg', extension: 'jpeg' },
          { mediaUrl: 'https://cdn.example/photo-2.jpeg', extension: 'jpeg' }
        ]
      }
    });
  });

  test('returns null when gallery-dl resolves no still images', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([
        [2, { category: 'tiktok' }],
        [3, 'https://cdn.example/video.mp4', { extension: 'mp4', num: 1 }]
      ]),
      stderr: ''
    });

    await expect(
      resolveTiktokGalleryWithGalleryDl({
        text: 'https://www.tiktok.com/@creator/video/123',
        execFile
      })
    ).resolves.toBeNull();
  });
});
