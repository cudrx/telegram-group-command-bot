import { describe, expect, test, vi } from 'vitest';

import { dispatchMemeMedia } from '../../../src/app/chat-orchestrator/meme/telegram-dispatcher.js';

describe('dispatchMemeMedia', () => {
  test('adapts gallery downloads to the meme dispatcher', async () => {
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
        kind: 'gallery',
        files: [
          { filePath: '/tmp/1.jpg', cleanup: vi.fn() },
          { filePath: '/tmp/2.jpg', cleanup: vi.fn() }
        ],
        cleanup: vi.fn()
      }
    });

    expect(memeDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 10,
      caption: 'caption',
      media: {
        kind: 'gallery',
        files: [{ filePath: '/tmp/1.jpg' }, { filePath: '/tmp/2.jpg' }]
      }
    });
  });
});
