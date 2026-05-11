import { existsSync } from 'node:fs';

import { describe, expect, test, vi } from 'vitest';

import { createIncomingMessage } from '../../database/support.js';
import { FakeDatabaseClient } from '../support/fake-database.js';
import { createReplyResult } from '../support/llm.js';
import { createOrchestrator } from '../support/orchestrator.js';

function redditListing(posts: unknown[]) {
  return new Response(
    JSON.stringify({
      data: {
        children: posts.map((data) => ({ kind: 't3', data }))
      }
    })
  );
}

describe('ChatOrchestrator /meme command', () => {
  test('fetches a meme, localizes caption, sends media, saves history and bot message', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'abc',
            subreddit: 'memes',
            title: "It's true.",
            ups: 50592,
            permalink: '/r/memes/comments/abc/its_true/',
            is_self: false,
            url: 'https://i.redd.it/a.jpeg'
          }
        ])
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Length': '3' }
        })
      );
    const generateMemeCaption = vi
      .fn()
      .mockResolvedValue(createReplyResult('Это правда.'));
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 500,
      createdAt: '2026-05-11T10:00:00.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      random: () => 0,
      now: () => '2026-05-11T10:00:00.000Z',
      qwen: {
        generateReply: vi.fn(),
        generateMemeCaption
      },
      replyDispatcher: vi.fn(),
      memeDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        createdAt: '2026-05-11T10:00:00.000Z'
      })
    );

    expect(generateMemeCaption).toHaveBeenCalledWith({
      title: "It's true.",
      subreddit: 'memes',
      upvotes: 50592,
      permalink: '/r/memes/comments/abc/its_true/',
      mediaKind: 'image'
    });
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: 10,
        caption: 'Это правда.\n\nr/memes · 50 592 апвоутов',
        media: expect.objectContaining({ kind: 'image' })
      })
    );
    expect(db.savedMemePosts).toHaveLength(1);
    expect(db.savedMemePosts[0]).toMatchObject({
      redditPostId: 'abc',
      telegramMessageId: 500,
      mediaKind: 'image'
    });
    expect(db.getMessageByTelegramMessageId(1, 500)).toMatchObject({
      text: 'Это правда.\n\nr/memes · 50 592 апвоутов',
      isBot: true,
      replyToMessageId: 10
    });
  });

  test('tries another shuffled source when first source has only seen posts', async () => {
    const db = new FakeDatabaseClient();
    db.saveMemePost({
      chatId: 1,
      redditPostId: 'seen',
      subreddit: 'blursed_videos',
      telegramMessageId: 1,
      title: 'seen',
      permalink: '/r/blursed_videos/comments/seen/seen/',
      mediaKind: 'image',
      mediaUrl: 'https://i.redd.it/seen.jpeg',
      upvotes: 1,
      sentAt: '2026-05-10T00:00:00.000Z'
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'seen',
            subreddit: 'blursed_videos',
            title: 'seen',
            ups: 1,
            permalink: '/r/blursed_videos/comments/seen/seen/',
            is_self: false,
            url: 'https://i.redd.it/seen.jpeg'
          }
        ])
      )
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'fresh',
            subreddit: 'dankvideos',
            title: 'fresh',
            ups: 2,
            permalink: '/r/dankvideos/comments/fresh/fresh/',
            is_self: false,
            url: 'https://i.redd.it/fresh.jpeg'
          }
        ])
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1])));
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      random: () => 0,
      now: () => '2026-05-11T10:00:00.000Z',
      qwen: {
        generateReply: vi.fn(),
        generateMemeCaption: vi
          .fn()
          .mockResolvedValue(createReplyResult('свежее'))
      },
      replyDispatcher: vi.fn(),
      memeDispatcher: vi.fn().mockResolvedValue({
        messageId: 501,
        createdAt: '2026-05-11T10:00:00.000Z'
      })
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(db.savedMemePosts.at(-1)).toMatchObject({ redditPostId: 'fresh' });
  });

  test('continues to the next source when sending a candidate fails', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'bad',
            subreddit: 'blursed_videos',
            title: 'bad',
            ups: 1,
            permalink: '/r/blursed_videos/comments/bad/bad/',
            is_self: false,
            url: 'https://i.redd.it/bad.jpeg'
          }
        ])
      )
      .mockResolvedValueOnce(new Response('too large', { status: 413 }))
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'fresh',
            subreddit: 'dankvideos',
            title: 'fresh',
            ups: 2,
            permalink: '/r/dankvideos/comments/fresh/fresh/',
            is_self: false,
            url: 'https://i.redd.it/fresh.jpeg'
          }
        ])
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1])));
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 502,
      createdAt: '2026-05-11T10:00:00.000Z'
    });
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      random: () => 0,
      now: () => '2026-05-11T10:00:00.000Z',
      qwen: {
        generateReply: vi.fn(),
        generateMemeCaption: vi
          .fn()
          .mockResolvedValue(createReplyResult('готово'))
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
    expect(replyDispatcher).not.toHaveBeenCalled();
    expect(db.savedMemePosts).toHaveLength(1);
    expect(db.savedMemePosts[0]).toMatchObject({ redditPostId: 'fresh' });
  });

  test('sends local fallback without LLM when all attempted sources are exhausted', async () => {
    const db = new FakeDatabaseClient();
    const generateMemeCaption = vi.fn();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 600,
      createdAt: '2026-05-11T10:00:00.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      fetch: vi
        .fn()
        .mockImplementation(() => Promise.resolve(redditListing([]))),
      qwen: {
        generateReply: vi.fn(),
        generateMemeCaption
      },
      replyDispatcher,
      memeDispatcher: vi.fn()
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(generateMemeCaption).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Мемы закончились, идите трогайте траву.'
      })
    );
    expect(db.getMessageByTelegramMessageId(1, 600)).toMatchObject({
      text: 'Мемы закончились, идите трогайте траву.',
      isBot: true,
      replyToMessageId: 10
    });
  });

  test('cleans up downloaded media when meme dispatch fails', async () => {
    let dispatchedFilePath = '';
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'cleanup',
            subreddit: 'memes',
            title: 'cleanup',
            ups: 10,
            permalink: '/r/memes/comments/cleanup/cleanup/',
            is_self: false,
            url: 'https://i.redd.it/cleanup.jpeg'
          }
        ])
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Length': '3' }
        })
      );
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      random: () => 0,
      now: () => '2026-05-11T10:00:00.000Z',
      qwen: {
        generateReply: vi.fn(),
        generateMemeCaption: vi.fn().mockResolvedValue(createReplyResult('ой'))
      },
      replyDispatcher: vi.fn().mockResolvedValue({
        messageId: 601,
        createdAt: '2026-05-11T10:00:00.000Z'
      }),
      memeDispatcher: vi.fn().mockImplementation((input) => {
        if (input.media.kind === 'image') {
          dispatchedFilePath = input.media.filePath;
        }

        throw new Error('telegram failed');
      })
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(dispatchedFilePath).not.toBe('');
    expect(existsSync(dispatchedFilePath)).toBe(false);
    expect(db.savedMemePosts).toHaveLength(0);
  });
});
