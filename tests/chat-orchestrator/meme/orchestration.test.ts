import { existsSync } from 'node:fs';

import { describe, expect, test, vi } from 'vitest';

import { createIncomingMessage } from '../../database/support.js';
import { FakeDatabaseClient } from '../support/fake-database.js';
import { createOrchestrator } from '../support/orchestrator.js';

function memeApiListing(memes: unknown[]) {
  return new Response(
    JSON.stringify({
      count: memes.length,
      memes
    })
  );
}

function emptyMemeApiListing() {
  return new Response(
    JSON.stringify({
      code: 400,
      message: 'r/unexpected has no Posts with Images'
    }),
    { status: 400 }
  );
}

describe('ChatOrchestrator /meme command', () => {
  test('fetches a meme, sends original caption, saves history and bot message without LLM captioning', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        memeApiListing([
          {
            postLink: 'https://redd.it/abc',
            subreddit: 'memes',
            title: "It's true.",
            url: 'https://i.redd.it/a.jpeg',
            nsfw: false,
            spoiler: false,
            ups: 50592
          }
        ])
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Length': '3' }
        })
      );
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
        generateReply: vi.fn()
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

    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: 10,
        caption: `It's true.\n\nr/memes · <a href="https://redd.it/abc">↑50592</a>`,
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
      text: `It's true.\n\nr/memes · <a href="https://redd.it/abc">↑50592</a>`,
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
      upvotes: 10,
      sentAt: '2026-05-10T00:00:00.000Z'
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        memeApiListing([
          {
            postLink: 'https://redd.it/seen',
            subreddit: 'blursed_videos',
            title: 'seen',
            url: 'https://i.redd.it/seen.jpeg',
            nsfw: false,
            spoiler: false,
            ups: 10
          }
        ])
      )
      .mockResolvedValueOnce(
        memeApiListing([
          {
            postLink: 'https://redd.it/fresh',
            subreddit: 'dankvideos',
            title: 'fresh',
            url: 'https://i.redd.it/fresh.jpeg',
            nsfw: false,
            spoiler: false,
            ups: 20
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
        generateReply: vi.fn()
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
        memeApiListing([
          {
            postLink: 'https://redd.it/bad',
            subreddit: 'blursed_videos',
            title: 'bad',
            url: 'https://i.redd.it/bad.jpeg',
            nsfw: false,
            spoiler: false,
            ups: 10
          }
        ])
      )
      .mockResolvedValueOnce(new Response('too large', { status: 413 }))
      .mockResolvedValueOnce(
        memeApiListing([
          {
            postLink: 'https://redd.it/fresh',
            subreddit: 'dankvideos',
            title: 'fresh',
            url: 'https://i.redd.it/fresh.jpeg',
            nsfw: false,
            spoiler: false,
            ups: 20
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
    expect(replyDispatcher).not.toHaveBeenCalled();
    expect(db.savedMemePosts).toHaveLength(1);
    expect(db.savedMemePosts[0]).toMatchObject({ redditPostId: 'fresh' });
  });

  test('sends local fallback without LLM when all attempted sources are exhausted', async () => {
    const db = new FakeDatabaseClient();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 600,
      createdAt: '2026-05-11T10:00:00.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      fetch: vi
        .fn()
        .mockImplementation(() => Promise.resolve(emptyMemeApiListing())),
      qwen: {
        generateReply: vi.fn()
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
        memeApiListing([
          {
            postLink: 'https://redd.it/cleanup',
            subreddit: 'memes',
            title: 'cleanup',
            url: 'https://i.redd.it/cleanup.jpeg',
            nsfw: false,
            spoiler: false,
            ups: 10
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
        generateReply: vi.fn()
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

  test('skips candidates below the minimum upvote threshold', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        memeApiListing([
          {
            postLink: 'https://redd.it/zero',
            subreddit: 'hmm',
            title: 'zero',
            url: 'https://i.redd.it/zero.jpeg',
            nsfw: false,
            spoiler: false,
            ups: 0
          },
          {
            postLink: 'https://redd.it/low',
            subreddit: 'hmm',
            title: 'low',
            url: 'https://i.redd.it/low.jpeg',
            nsfw: false,
            spoiler: false,
            ups: 9
          }
        ])
      )
      .mockResolvedValueOnce(
        memeApiListing([
          {
            postLink: 'https://redd.it/fresh',
            subreddit: 'marvelcirclejerk',
            title: 'fresh',
            url: 'https://i.redd.it/fresh.jpeg',
            nsfw: false,
            spoiler: false,
            ups: 10
          }
        ])
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1])));
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 503,
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
      replyDispatcher: vi.fn(),
      memeDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: `fresh\n\nr/marvelcirclejerk · <a href="https://redd.it/fresh">↑10</a>`
      })
    );
    expect(db.savedMemePosts).toHaveLength(1);
    expect(db.savedMemePosts[0]).toMatchObject({ redditPostId: 'fresh' });
  });
});
