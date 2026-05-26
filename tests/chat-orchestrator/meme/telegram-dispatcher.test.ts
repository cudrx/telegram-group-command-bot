import { describe, expect, test, vi } from 'vitest';

import { dispatchMemeMedia } from '../../../src/app/actions/meme/telegram-dispatcher.js';

describe('dispatchMemeMedia', () => {
  test('adapts image downloads to the meme dispatcher', async () => {
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 100,
      createdAt: '2026-05-11T10:00:00.000Z'
    });

    await dispatchMemeMedia({
      memeDispatcher,
      chatId: 1,
      replyToMessageId: 10,
      caption: 'caption',
      media: {
        kind: 'image',
        filePath: '/tmp/1.jpg',
        extension: 'jpg',
        cleanup: vi.fn()
      }
    });

    expect(memeDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 10,
      caption: 'caption',
      media: {
        kind: 'image',
        filePath: '/tmp/1.jpg'
      }
    });
  });

  test('can disable reply when adapting meme dispatch', async () => {
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 100,
      createdAt: '2026-05-11T10:00:00.000Z'
    });

    await dispatchMemeMedia({
      memeDispatcher,
      chatId: 1,
      replyToMessageId: 10,
      reply: false,
      caption: 'caption',
      media: {
        kind: 'image',
        filePath: '/tmp/1.jpg',
        extension: 'jpg',
        cleanup: vi.fn()
      }
    });

    expect(memeDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 10,
      reply: false,
      caption: 'caption',
      media: {
        kind: 'image',
        filePath: '/tmp/1.jpg'
      }
    });
  });

  test('adapts gallery downloads to the meme dispatcher', async () => {
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 103,
      createdAt: '2026-05-11T10:00:00.000Z'
    });

    await dispatchMemeMedia({
      memeDispatcher,
      chatId: 1,
      replyToMessageId: 10,
      caption: 'caption',
      hasSpoiler: true,
      media: {
        kind: 'gallery',
        items: [
          { filePath: '/tmp/1.jpg', extension: 'jpg', hasSpoiler: true },
          { filePath: '/tmp/2.png', extension: 'png', hasSpoiler: true }
        ],
        cleanup: vi.fn()
      }
    });

    expect(memeDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 10,
      caption: 'caption',
      hasSpoiler: true,
      media: {
        kind: 'gallery',
        items: [
          { filePath: '/tmp/1.jpg', hasSpoiler: true },
          { filePath: '/tmp/2.png', hasSpoiler: true }
        ]
      }
    });
  });

  test('preserves per-item spoiler flags for gallery downloads', async () => {
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 104,
      createdAt: '2026-05-11T10:00:00.000Z'
    });

    await dispatchMemeMedia({
      memeDispatcher,
      chatId: 1,
      replyToMessageId: 10,
      caption: 'caption',
      media: {
        kind: 'gallery',
        items: [
          { filePath: '/tmp/1.jpg', extension: 'jpg', hasSpoiler: true },
          { filePath: '/tmp/2.png', extension: 'png', hasSpoiler: true }
        ],
        cleanup: vi.fn()
      }
    });

    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        media: {
          kind: 'gallery',
          items: [
            { filePath: '/tmp/1.jpg', hasSpoiler: true },
            { filePath: '/tmp/2.png', hasSpoiler: true }
          ]
        }
      })
    );
  });

  test('adapts video downloads to the meme dispatcher', async () => {
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 101,
      createdAt: '2026-05-11T10:00:00.000Z'
    });

    await dispatchMemeMedia({
      memeDispatcher,
      chatId: 1,
      replyToMessageId: 10,
      caption: 'caption',
      media: {
        kind: 'video',
        filePath: '/tmp/1.mp4',
        extension: 'mp4',
        cleanup: vi.fn()
      }
    });

    expect(memeDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 10,
      caption: 'caption',
      media: {
        kind: 'video',
        filePath: '/tmp/1.mp4'
      }
    });
  });

  test('passes Telegram spoiler flag to the meme dispatcher', async () => {
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 102,
      createdAt: '2026-05-11T10:00:00.000Z'
    });

    await dispatchMemeMedia({
      memeDispatcher,
      chatId: 1,
      replyToMessageId: null,
      reply: false,
      caption: 'caption',
      hasSpoiler: true,
      media: {
        kind: 'video',
        filePath: '/tmp/1.mp4',
        extension: 'mp4',
        cleanup: vi.fn()
      }
    });

    expect(memeDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: null,
      reply: false,
      caption: 'caption',
      hasSpoiler: true,
      media: {
        kind: 'video',
        filePath: '/tmp/1.mp4'
      }
    });
  });
});
