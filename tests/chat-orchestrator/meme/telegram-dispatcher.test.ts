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

  test('adapts animation downloads to the meme dispatcher', async () => {
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 101,
      createdAt: '2026-05-11T10:01:00.000Z'
    });

    await dispatchMemeMedia({
      memeDispatcher,
      chatId: 1,
      replyToMessageId: 10,
      caption: 'caption',
      media: {
        kind: 'animation',
        filePath: '/tmp/1.gif',
        extension: 'gif',
        cleanup: vi.fn()
      }
    });

    expect(memeDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 10,
      caption: 'caption',
      media: {
        kind: 'animation',
        filePath: '/tmp/1.gif'
      }
    });
  });

  test('rejects unsupported gallery downloads before dispatching', async () => {
    const memeDispatcher = vi.fn();

    await expect(
      dispatchMemeMedia({
        memeDispatcher,
        chatId: 1,
        replyToMessageId: 10,
        caption: 'caption',
        media: unsupportedDownloadedMedia({
          kind: 'gallery',
          files: [
            { filePath: '/tmp/1.jpg', cleanup: vi.fn() },
            { filePath: '/tmp/2.jpg', cleanup: vi.fn() }
          ],
          cleanup: vi.fn()
        })
      })
    ).rejects.toThrow('Unsupported meme media kind for Telegram dispatch');

    expect(memeDispatcher).not.toHaveBeenCalled();
  });

  test('rejects unsupported video downloads before dispatching', async () => {
    const memeDispatcher = vi.fn();

    await expect(
      dispatchMemeMedia({
        memeDispatcher,
        chatId: 1,
        replyToMessageId: 10,
        caption: 'caption',
        media: unsupportedDownloadedMedia({
          kind: 'video',
          filePath: '/tmp/1.mp4',
          extension: 'mp4',
          cleanup: vi.fn()
        })
      })
    ).rejects.toThrow('Unsupported meme media kind for Telegram dispatch');

    expect(memeDispatcher).not.toHaveBeenCalled();
  });
});

function unsupportedDownloadedMedia(
  media: unknown
): Parameters<typeof dispatchMemeMedia>[0]['media'] {
  return media as Parameters<typeof dispatchMemeMedia>[0]['media'];
}
