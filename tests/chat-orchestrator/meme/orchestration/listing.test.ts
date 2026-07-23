import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createIncomingMessage } from '../../../database/support.js';
import { createTestChatPolicy } from '../../../helpers/telegram-fixtures.js';
import { FakeDatabaseClient } from '../../support/fake-database.js';
import { createOrchestrator } from '../../support/orchestrator.js';
import {
  redditListing,
  videoProbeResult,
  writeNormalizedVideo
} from './support.js';

describe('ChatOrchestrator /meme command — listing', () => {
  test('fetches a meme, sends original caption, saves history and bot message without LLM captioning', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'abc',
            subreddit: 'memes',
            title: "It's true.",
            url: 'https://i.redd.it/a.jpeg',
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
    const sendChatAction = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      random: () => 0,
      now: () => '2026-05-11T10:00:00.000Z',
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher: vi.fn(),
      memeDispatcher,
      sendChatAction
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
        replyToMessageId: null,
        reply: false,
        caption: `It's true.\n\nr/memes · <a href="https://www.reddit.com/r/memes/comments/abc/post_title/">↑50592</a>`,
        media: expect.objectContaining({ kind: 'image' })
      })
    );
    expect(sendChatAction).toHaveBeenCalledWith(1, 'upload_photo');
    expect(db.savedMemePosts).toHaveLength(1);
    expect(db.savedMemePosts[0]).toMatchObject({
      redditPostId: 'abc',
      telegramMessageId: 500,
      mediaKind: 'image'
    });
    expect(db.getMessageByTelegramMessageId(1, 500)).toMatchObject({
      text: `It's true.\n\nr/memes · <a href="https://www.reddit.com/r/memes/comments/abc/post_title/">↑50592</a>`,
      isBot: true,
      replyToMessageId: null
    });
  });

  test('fetches sex media with the meme flow using sex subreddits', async () => {
    const db = new FakeDatabaseClient();
    const sexSubreddit = 'custom-sex-subreddit';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'sex-post',
            subreddit: sexSubreddit,
            title: 'sex command post',
            url: 'https://i.redd.it/sex.jpeg',
            ups: 100
          }
        ])
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Length': '3' }
        })
      );
    const replyDispatcher = vi
      .fn()
      .mockResolvedValueOnce({
        messageId: 710,
        createdAt: '2026-05-11T10:00:00.000Z'
      })
      .mockResolvedValueOnce({
        messageId: 711,
        createdAt: '2026-05-11T10:00:01.000Z'
      });
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 520,
      createdAt: '2026-05-11T10:00:00.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      random: () => 0,
      now: () => '2026-05-11T10:00:00.000Z',
      env: {
        telegramChatPolicies: [
          createTestChatPolicy({
            chatId: 1,
            reddit_sources: {
              sex: [sexSubreddit]
            }
          })
        ]
      },
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher,
      memeDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/sex',
        entities: [{ type: 'bot_command', offset: 0, length: 4 }],
        createdAt: '2026-05-11T10:00:00.000Z'
      })
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://www.reddit.com/r/${sexSubreddit}/top/.json?t=month&limit=10`,
      expect.any(Object)
    );
    expect(replyDispatcher).toHaveBeenNthCalledWith(1, {
      chatId: 1,
      replyToMessageId: null,
      reply: false,
      text: 'Скачиваю пост'
    });
    expect(replyDispatcher).toHaveBeenCalledTimes(1);
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: null,
        reply: false,
        hasSpoiler: true,
        caption: `sex command post\n\nr/${sexSubreddit} · <a href="https://www.reddit.com/r/${sexSubreddit}/comments/sex-post/post_title/">↑100</a>`,
        media: expect.objectContaining({ kind: 'image' })
      })
    );
    expect(db.savedMemePosts[0]).toMatchObject({
      redditPostId: 'sex-post',
      telegramMessageId: 520,
      mediaKind: 'image'
    });
  });

  test('logs the Reddit post URL when a sex candidate fails before trying the next post', async () => {
    const db = new FakeDatabaseClient();
    const sexSubreddit = 'custom-sex-subreddit';
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
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'sex-failed',
            subreddit: sexSubreddit,
            title: 'bad dimensions',
            url: 'https://i.redd.it/sex-failed.jpeg',
            ups: 120
          },
          {
            id: 'sex-success',
            subreddit: sexSubreddit,
            title: 'good dimensions',
            url: 'https://i.redd.it/sex-success.jpeg',
            ups: 110
          }
        ])
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Length': '3' }
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([4, 5, 6]), {
          headers: { 'Content-Length': '3' }
        })
      );
    const memeDispatcher = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Call to 'sendPhoto' failed! (400: Bad Request: PHOTO_INVALID_DIMENSIONS)"
        )
      )
      .mockResolvedValueOnce({
        messageId: 522,
        createdAt: '2026-05-11T10:00:01.000Z'
      });
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      logger,
      random: () => 0,
      now: () => '2026-05-11T10:00:00.000Z',
      env: {
        telegramChatPolicies: [
          createTestChatPolicy({
            chatId: 1,
            reddit_sources: {
              sex: [sexSubreddit]
            }
          })
        ]
      },
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher: vi.fn(),
      memeDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/sex',
        entities: [{ type: 'bot_command', offset: 0, length: 4 }],
        createdAt: '2026-05-11T10:00:00.000Z'
      })
    );

    expect(logger.warn).toHaveBeenCalledWith(
      'meme_candidate_failed',
      expect.objectContaining({
        subreddit: sexSubreddit,
        redditPostId: 'sex-failed',
        mediaKind: 'image',
        permalink: `https://www.reddit.com/r/${sexSubreddit}/comments/sex-failed/post_title/`,
        errorMessage:
          "Call to 'sendPhoto' failed! (400: Bad Request: PHOTO_INVALID_DIMENSIONS)"
      })
    );
    expect(memeDispatcher).toHaveBeenCalledTimes(2);
  });

  test('always sends sex video media as Telegram spoiler media', async () => {
    let dispatchedFilePath = '';
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'sex-listing-video-test-')
    );
    await writeFile(
      path.join(dataDirectory, 'reddit-cookies.txt'),
      '.reddit.com\tTRUE\t/\tTRUE\t2147483647\tsession\tabc123'
    );
    const db = new FakeDatabaseClient();
    const sexSubreddit = 'custom-sex-subreddit';

    const fetchMock = vi.fn().mockResolvedValueOnce(
      redditListing([
        {
          id: 'sex-video',
          subreddit: sexSubreddit,
          title: 'sex command video',
          url: 'https://v.redd.it/video-post',
          ups: 111,
          secure_media: {
            reddit_video: {
              fallback_url:
                'https://v.redd.it/video-post/DASH_720.mp4?source=fallback',
              duration: 12
            }
          }
        }
      ])
    );
    const execFile = vi
      .fn()
      .mockImplementation(
        async (
          file: string,
          args: string[],
          options: { cwd?: string | undefined }
        ) => {
          if (file === 'ffprobe') return videoProbeResult();

          if (file === 'nice') return writeNormalizedVideo(args);

          expect(file).toBe('yt-dlp');

          if (args.includes('--dump-single-json')) {
            return {
              stdout: JSON.stringify({
                id: 'sex-video',
                title: 'sex command video',
                like_count: 111,
                duration: 12
              }),
              stderr: ''
            };
          }

          const outputIndex = args.indexOf('-o');
          const outputTemplate = args[outputIndex + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, 'sex-video.mp4'),
            new Uint8Array([1, 2, 3])
          );

          expect(options.cwd).toBe(tempDirectory);
          return { stdout: '', stderr: '' };
        }
      );
    const memeDispatcher = vi.fn().mockImplementation((input) => {
      dispatchedFilePath = input.media.filePath;

      return Promise.resolve({
        messageId: 521,
        createdAt: '2026-05-11T10:00:00.000Z'
      });
    });
    const sendChatAction = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      execFile,
      random: () => 0,
      now: () => '2026-05-11T10:00:00.000Z',
      env: {
        sqlitePath: path.join(dataDirectory, 'bot.sqlite'),
        telegramChatPolicies: [
          createTestChatPolicy({
            chatId: 1,
            reddit_sources: {
              sex: [sexSubreddit]
            }
          })
        ]
      },
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher: vi.fn(),
      memeDispatcher,
      sendChatAction
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/sex',
        entities: [{ type: 'bot_command', offset: 0, length: 4 }]
      })
    );

    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        hasSpoiler: true,
        media: expect.objectContaining({ kind: 'video' })
      })
    );
    expect(dispatchedFilePath).not.toBe('');
    expect(existsSync(dispatchedFilePath)).toBe(false);
  });

  test('handles /meme as a command even when the message also contains a Reddit URL', async () => {
    const db = new FakeDatabaseClient();
    const memeSubreddit = 'custom-meme-subreddit';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'abc',
            subreddit: 'memes',
            title: 'command meme',
            url: 'https://i.redd.it/a.jpeg',
            ups: 20
          }
        ])
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 515,
      createdAt: '2026-05-11T10:00:00.000Z'
    });
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      random: () => 0,
      now: () => '2026-05-11T10:00:00.000Z',
      env: {
        telegramChatPolicies: [
          createTestChatPolicy({
            chatId: 1,
            reddit_sources: {
              meme: [memeSubreddit]
            }
          })
        ]
      },
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher: vi.fn(),
      memeDispatcher,
      deleteMessageDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme https://www.reddit.com/r/SipsTea/comments/1ti5fvt/title/',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://www.reddit.com/r/${memeSubreddit}/top/.json?t=month&limit=10`,
      expect.any(Object)
    );
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        caption:
          'command meme\n\nr/memes · <a href="https://www.reddit.com/r/memes/comments/abc/post_title/">↑20</a>'
      })
    );
    expect(deleteMessageDispatcher).not.toHaveBeenCalled();
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
        redditListing([
          {
            id: 'seen',
            subreddit: 'blursed_videos',
            title: 'seen',
            url: 'https://i.redd.it/seen.jpeg',
            ups: 10
          }
        ])
      )
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'fresh',
            subreddit: 'dankvideos',
            title: 'fresh',
            url: 'https://i.redd.it/fresh.jpeg',
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

  test('downloads Reddit listing video candidates through yt-dlp', async () => {
    let dispatchedFilePath = '';
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'reddit-listing-video-test-')
    );
    await writeFile(
      path.join(dataDirectory, 'reddit-cookies.txt'),
      '.reddit.com\tTRUE\t/\tTRUE\t2147483647\tsession\tabc123'
    );
    const db = new FakeDatabaseClient();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      redditListing([
        {
          id: 'vidfresh',
          subreddit: 'SipsTea',
          title: 'fresh video',
          url: 'https://v.redd.it/video-post',
          ups: 111,
          secure_media: {
            reddit_video: {
              fallback_url:
                'https://v.redd.it/video-post/DASH_720.mp4?source=fallback',
              duration: 12
            }
          }
        }
      ])
    );
    const execFile = vi
      .fn()
      .mockImplementation(
        async (
          file: string,
          args: string[],
          options: { cwd?: string | undefined }
        ) => {
          if (file === 'ffprobe') return videoProbeResult();

          if (file === 'nice') return writeNormalizedVideo(args);

          expect(file).toBe('yt-dlp');

          if (args.includes('--dump-single-json')) {
            return {
              stdout: JSON.stringify({
                id: 'vidfresh',
                title: 'fresh video',
                like_count: 111,
                duration: 12
              }),
              stderr: ''
            };
          }

          const outputIndex = args.indexOf('-o');
          const outputTemplate = args[outputIndex + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, 'vidfresh.mp4'),
            new Uint8Array([1, 2, 3])
          );

          expect(args).toContain(
            'https://www.reddit.com/r/SipsTea/comments/vidfresh/post_title/'
          );
          expect(options.cwd).toBe(tempDirectory);
          return { stdout: '', stderr: '' };
        }
      );
    const memeDispatcher = vi.fn().mockImplementation((input) => {
      dispatchedFilePath = input.media.filePath;

      return Promise.resolve({
        messageId: 512,
        createdAt: '2026-05-11T10:00:00.000Z'
      });
    });
    const sendChatAction = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      execFile,
      random: () => 0,
      now: () => '2026-05-11T10:00:00.000Z',
      env: {
        sqlitePath: path.join(dataDirectory, 'bot.sqlite')
      },
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher: vi.fn(),
      memeDispatcher,
      sendChatAction
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(execFile).toHaveBeenCalledTimes(5);
    expect(sendChatAction).toHaveBeenCalledWith(1, 'upload_video');
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        caption:
          'fresh video\n\nr/SipsTea · <a href="https://www.reddit.com/r/SipsTea/comments/vidfresh/post_title/">↑111</a>',
        media: expect.objectContaining({ kind: 'video' })
      })
    );
    expect(db.savedMemePosts[0]).toMatchObject({
      redditPostId: 'vidfresh',
      mediaKind: 'video',
      mediaUrl: 'https://www.reddit.com/r/SipsTea/comments/vidfresh/post_title/'
    });
    expect(dispatchedFilePath).not.toBe('');
    expect(existsSync(dispatchedFilePath)).toBe(false);
  });

  test('sends NSFW or spoiler Reddit listing media as Telegram spoiler media', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'nsfw',
            subreddit: 'memes',
            title: 'marked post',
            url: 'https://i.redd.it/nsfw.jpeg',
            ups: 20,
            over_18: true
          }
        ])
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 516,
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
        hasSpoiler: true,
        media: expect.objectContaining({ kind: 'image' })
      })
    );
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
            url: 'https://i.redd.it/bad.jpeg',
            ups: 10
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
            url: 'https://i.redd.it/fresh.jpeg',
            ups: 20
          }
        ])
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1])));
    const memeDispatcher = vi.fn().mockResolvedValue({
      messageId: 502,
      createdAt: '2026-05-11T10:00:00.000Z'
    });
    const replyDispatcher = vi
      .fn()
      .mockResolvedValueOnce({
        messageId: 701,
        createdAt: '2026-05-11T10:00:00.000Z'
      })
      .mockResolvedValueOnce({
        messageId: 702,
        createdAt: '2026-05-11T10:00:01.000Z'
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
      replyToMessageId: null,
      reply: false,
      text: 'Скачиваю мем'
    });
    expect(db.savedMemePosts).toHaveLength(1);
    expect(db.savedMemePosts[0]).toMatchObject({ redditPostId: 'fresh' });
  });
});
