import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  test('expands a direct Reddit video link and deletes the source message after sending', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {},
            {
              data: {
                children: [
                  {
                    data: {
                      id: '1ti5fvt',
                      subreddit: 'SipsTea',
                      title: 'AI vs creativity from a pro-AI greedy corpo',
                      permalink:
                        '/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/',
                      ups: 24123,
                      over_18: false,
                      spoiler: false,
                      secure_media: {
                        reddit_video: {
                          fallback_url:
                            'https://v.redd.it/video123/DASH_720.mp4?source=fallback',
                          duration: 42
                        }
                      }
                    }
                  }
                ]
              }
            }
          ])
        )
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: {
            'Content-Length': '4',
            'Content-Type': 'video/mp4'
          }
        })
      );
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 510,
      createdAt: '2026-05-20T10:00:00.000Z',
      mediaSnapshot: {
        messageId: 510,
        mediaKind: 'video',
        fileId: 'telegram-video',
        fileUniqueId: 'telegram-video-unique',
        mimeType: 'video/mp4',
        fileSize: 4,
        durationSeconds: 42,
        caption:
          'AI vs creativity from a pro-AI greedy corpo\n\nr/SipsTea · <a href="https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/">↑24123</a>'
      }
    });
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher: vi.fn(),
      memeDispatcher,
      deleteMessageDispatcher,
      now: () => '2026-05-20T10:00:00.000Z'
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: 'https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/',
        entities: [],
        messageId: 42,
        chatType: 'supergroup'
      })
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/.json',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://v.redd.it/video123/DASH_720.mp4?source=fallback',
      expect.any(Object)
    );
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: 42,
        caption:
          'AI vs creativity from a pro-AI greedy corpo\n\nr/SipsTea · <a href="https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/">↑24123</a>',
        media: expect.objectContaining({ kind: 'video' })
      })
    );
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      messageId: 42
    });
    expect(db.savedMemePosts).toHaveLength(1);
    expect(db.savedMemePosts[0]).toMatchObject({
      redditPostId: '1ti5fvt',
      subreddit: 'SipsTea',
      telegramMessageId: 510,
      mediaKind: 'video',
      mediaUrl: 'https://v.redd.it/video123/DASH_720.mp4?source=fallback',
      upvotes: 24123
    });
    expect(db.getMessageByTelegramMessageId(1, 510)).toMatchObject({
      text: 'AI vs creativity from a pro-AI greedy corpo\n\nr/SipsTea · <a href="https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/">↑24123</a>',
      isBot: true,
      replyToMessageId: 42,
      mediaSnapshot: expect.objectContaining({
        mediaKind: 'video',
        fileId: 'telegram-video'
      })
    });
  });

  test('logs and ignores direct Reddit video expansion failures', async () => {
    const db = new FakeDatabaseClient();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn()
    };
    logger.child.mockReturnValue(logger);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    const memeDispatcher = vi.fn();
    const deleteMessageDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      logger,
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher: vi.fn(),
      memeDispatcher,
      deleteMessageDispatcher
    });

    await expect(
      orchestrator.handleIncomingMessage(
        createIncomingMessage({
          text: 'https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/',
          entities: [],
          messageId: 43
        })
      )
    ).resolves.toBeUndefined();

    expect(memeDispatcher).not.toHaveBeenCalled();
    expect(deleteMessageDispatcher).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'reddit_video_resolution_failed',
      expect.objectContaining({
        errorMessage:
          'Reddit post request failed for https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/.json with status 429'
      })
    );
  });

  test('falls back to yt-dlp with cookies when Reddit JSON is blocked', async () => {
    let dispatchedFilePath = '';
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('blocked', { status: 403 }));
    const execFile = vi
      .fn()
      .mockImplementation(
        async (
          file: string,
          args: string[],
          options: { cwd?: string | undefined }
        ) => {
          expect(file).toBe('yt-dlp');

          if (args.includes('--dump-single-json')) {
            return {
              stdout: JSON.stringify({
                id: 'vp5yv91as62h1',
                title: 'AI vs Creativity from yt-dlp',
                webpage_url:
                  'https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/',
                like_count: 661,
                duration: 192
              }),
              stderr: ''
            };
          }

          const outputIndex = args.indexOf('-o');
          expect(outputIndex).toBeGreaterThanOrEqual(0);
          expect(args).toContain('/app/data/reddit-cookies.txt');
          expect(args).toContain('fallback/best[ext=mp4]/best');

          const outputTemplate = args[outputIndex + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, 'vp5yv91as62h1.mp4'),
            new Uint8Array([1, 2, 3, 4])
          );

          expect(options.cwd).toBe(tempDirectory);
          return { stdout: '', stderr: '' };
        }
      );
    const memeDispatcher = vi.fn().mockImplementation((input) => {
      dispatchedFilePath = input.media.filePath;

      return Promise.resolve({
        messageId: 511,
        createdAt: '2026-05-20T10:00:00.000Z'
      });
    });
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      execFile,
      env: {
        sqlitePath: '/app/data/bot.sqlite'
      },
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher: vi.fn(),
      memeDispatcher,
      deleteMessageDispatcher,
      now: () => '2026-05-20T10:00:00.000Z'
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: 'https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/',
        entities: [],
        messageId: 44,
        chatType: 'supergroup'
      })
    );

    expect(execFile).toHaveBeenCalledTimes(2);
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: 44,
        caption:
          'AI vs Creativity from yt-dlp\n\nr/SipsTea · <a href="https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/">↑661</a>',
        media: expect.objectContaining({ kind: 'video' })
      })
    );
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      messageId: 44
    });
    expect(db.savedMemePosts[0]).toMatchObject({
      redditPostId: '1ti5fvt',
      subreddit: 'SipsTea',
      telegramMessageId: 511,
      mediaKind: 'video',
      mediaUrl: 'yt-dlp:vp5yv91as62h1',
      upvotes: 661
    });
    expect(dispatchedFilePath).not.toBe('');
    expect(existsSync(dispatchedFilePath)).toBe(false);
  });

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
