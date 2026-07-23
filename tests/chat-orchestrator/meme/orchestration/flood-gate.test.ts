import { describe, expect, test, vi } from 'vitest';

import { createMemeFloodGate } from '../../../../src/app/meme-flood-gate.js';
import { createIncomingMessage } from '../../../database/support.js';
import { FakeDatabaseClient } from '../../support/fake-database.js';
import { createLogger } from '../../support/logger.js';
import { createOrchestrator } from '../../support/orchestrator.js';
import { redditListing } from './support.js';

describe('ChatOrchestrator /meme command — flood gate', () => {
  test('stops /meme after Telegram retry-after instead of trying more candidates', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'rate-limited',
            subreddit: 'memes',
            title: 'rate-limited',
            url: 'https://i.redd.it/rate-limited.jpeg',
            ups: 30
          },
          {
            id: 'would-have-worked',
            subreddit: 'memes',
            title: 'would-have-worked',
            url: 'https://i.redd.it/would-have-worked.jpeg',
            ups: 20
          }
        ])
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1])))
      .mockResolvedValueOnce(new Response(new Uint8Array([2])));
    const memeDispatcher = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Call to 'sendPhoto' failed! (429: Too Many Requests: retry after 15)"
        )
      )
      .mockResolvedValueOnce({
        messageId: 503,
        createdAt: '2026-05-11T10:00:01.000Z'
      });
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 703,
      createdAt: '2026-05-11T10:00:00.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      random: () => 0,
      now: () => '2026-05-11T10:00:00.000Z',
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher,
      memeDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(memeDispatcher).toHaveBeenCalledTimes(1);
    expect(replyDispatcher).toHaveBeenNthCalledWith(1, {
      chatId: 1,
      replyToMessageId: null,
      reply: false,
      text: 'Скачиваю мем'
    });
    expect(replyDispatcher).toHaveBeenNthCalledWith(2, {
      chatId: 1,
      replyToMessageId: 10,
      text: 'Телеграм просит подождать 15 сек. Попробуй позже.'
    });
    expect(db.savedMemePosts).toHaveLength(0);
  });

  test('rejects new /meme requests while the chat flood gate is active', async () => {
    const db = new FakeDatabaseClient();
    let now = '2026-05-11T10:00:00.000Z';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'rate-limited',
            subreddit: 'memes',
            title: 'rate-limited',
            url: 'https://i.redd.it/rate-limited.jpeg',
            ups: 30
          }
        ])
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1])));
    const memeDispatcher = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Call to 'sendPhoto' failed! (429: Too Many Requests: retry after 15)"
        )
      );
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 704,
      createdAt: '2026-05-11T10:00:00.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      memeFloodGate: createMemeFloodGate({
        nowMs: () => Date.parse(now)
      }),
      random: () => 0,
      now: () => now,
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher,
      memeDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        messageId: 10
      })
    );

    const fetchCallsAfterFirstJob = fetchMock.mock.calls.length;

    now = '2026-05-11T10:00:05.000Z';

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        messageId: 11,
        createdAt: '2026-05-11T10:00:05.000Z'
      })
    );

    expect(memeDispatcher).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(fetchCallsAfterFirstJob);
    expect(replyDispatcher).toHaveBeenNthCalledWith(2, {
      chatId: 1,
      replyToMessageId: 10,
      text: 'Телеграм просит подождать 15 сек. Попробуй позже.'
    });
    expect(replyDispatcher).toHaveBeenNthCalledWith(3, {
      chatId: 1,
      replyToMessageId: 11,
      text: 'Телеграм просит подождать 10 сек. Попробуй позже.'
    });
  });

  test('does not fail the job when flood-wait fallback cannot be sent during pre-check', async () => {
    const db = new FakeDatabaseClient();
    let now = '2026-05-11T10:00:00.000Z';
    const logger = createLogger();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'rate-limited',
            subreddit: 'memes',
            title: 'rate-limited',
            url: 'https://i.redd.it/rate-limited.jpeg',
            ups: 30
          }
        ])
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1])));
    const memeDispatcher = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Call to 'sendPhoto' failed! (429: Too Many Requests: retry after 15)"
        )
      );
    const replyDispatcher = vi
      .fn()
      .mockResolvedValueOnce({
        messageId: 705,
        createdAt: '2026-05-11T10:00:00.000Z'
      })
      .mockRejectedValueOnce(new Error('reply flood wait'));
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      random: () => 0,
      now: () => now,
      logger,
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher,
      memeDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        messageId: 10
      })
    );

    now = '2026-05-11T10:00:05.000Z';

    await expect(
      orchestrator.handleIncomingMessage(
        createIncomingMessage({
          text: '/meme',
          entities: [{ type: 'bot_command', offset: 0, length: 5 }],
          messageId: 11,
          createdAt: '2026-05-11T10:00:05.000Z'
        })
      )
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'meme_flood_wait_notice_failed',
      expect.objectContaining({
        errorMessage: 'reply flood wait'
      })
    );
  });
});
