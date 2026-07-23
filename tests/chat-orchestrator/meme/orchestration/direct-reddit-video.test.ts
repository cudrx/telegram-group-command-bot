import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  DirectVideoTooLargeError,
  DirectVideoTooLongError
} from '../../../../src/app/actions/meme/video-pipeline.js';
import { createIncomingMessage } from '../../../database/support.js';
import { FakeDatabaseClient } from '../../support/fake-database.js';
import { createOrchestrator } from '../../support/orchestrator.js';
import {
  redditPostResponse,
  videoProbeResult,
  writeNormalizedVideo
} from './support.js';

describe('ChatOrchestrator /meme command — direct Reddit video', () => {
  test('expands a direct Reddit video link without replying to the deleted source message', async () => {
    let dispatchedFilePath = '';
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'direct-reddit-video-test-')
    );
    await writeFile(
      path.join(dataDirectory, 'reddit-cookies.txt'),
      '.reddit.com\tTRUE\t/\tTRUE\t2147483647\treddit_session\tabc123'
    );
    const db = new FakeDatabaseClient();
    const canonicalUrl =
      'https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/';
    const fetchMock = vi.fn().mockResolvedValueOnce(
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
                    over_18: true,
                    spoiler: true,
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
            expect(args).toContain(canonicalUrl);
            return {
              stdout: JSON.stringify({
                id: '1ti5fvt',
                title: 'AI vs creativity from a pro-AI greedy corpo',
                like_count: 24123,
                duration: 42
              }),
              stderr: ''
            };
          }

          const outputIndex = args.indexOf('-o');
          const outputTemplate = args[outputIndex + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, '1ti5fvt.mp4'),
            new Uint8Array([1, 2, 3, 4])
          );

          expect(args).toContain(canonicalUrl);
          expect(options.cwd).toBe(tempDirectory);
          return { stdout: '', stderr: '' };
        }
      );
    const memeDispatcher = vi.fn().mockImplementation((input) => {
      dispatchedFilePath = input.media.filePath;

      return Promise.resolve({
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
    });
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      execFile,
      env: {
        sqlitePath: path.join(dataDirectory, 'bot.sqlite')
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
        messageId: 42,
        chatType: 'supergroup'
      })
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/.json',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledTimes(5);
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: null,
        reply: false,
        hasSpoiler: true,
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
      mediaUrl: canonicalUrl,
      upvotes: 24123
    });
    expect(db.getMessageByTelegramMessageId(1, 510)).toMatchObject({
      text: 'AI vs creativity from a pro-AI greedy corpo\n\nr/SipsTea · <a href="https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/">↑24123</a>',
      isBot: true,
      replyToMessageId: null,
      mediaSnapshot: expect.objectContaining({
        mediaKind: 'video',
        fileId: 'telegram-video'
      })
    });
    expect(dispatchedFilePath).not.toBe('');
    expect(existsSync(dispatchedFilePath)).toBe(false);
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
    const execFile = vi.fn().mockRejectedValue(new Error('yt-dlp unavailable'));
    const memeDispatcher = vi.fn();
    const deleteMessageDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      execFile,
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
    expect(execFile).toHaveBeenCalledWith(
      'yt-dlp',
      expect.arrayContaining(['--dump-single-json']),
      expect.any(Object)
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'reddit_video_ytdlp_failed',
      expect.objectContaining({
        errorMessage: 'yt-dlp unavailable'
      })
    );
  });

  test('replies with a size-specific fallback when Telegram rejects a direct Reddit video upload', async () => {
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'direct-reddit-video-telegram-413-test-')
    );
    await writeFile(
      path.join(dataDirectory, 'reddit-cookies.txt'),
      '.reddit.com\tTRUE\t/\tTRUE\t2147483647\treddit_session\tabc123'
    );
    const db = new FakeDatabaseClient();
    const canonicalUrl =
      'https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/';
    const fetchMock = vi.fn().mockResolvedValueOnce(
      redditPostResponse({
        id: '1ti5fvt',
        subreddit: 'SipsTea',
        title: 'AI vs creativity from a pro-AI greedy corpo',
        permalink:
          '/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/',
        ups: 24123,
        secure_media: {
          reddit_video: {
            fallback_url:
              'https://v.redd.it/video123/DASH_720.mp4?source=fallback',
            duration: 42
          }
        }
      })
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
                id: '1ti5fvt',
                title: 'AI vs creativity from a pro-AI greedy corpo',
                like_count: 24123,
                duration: 42
              }),
              stderr: ''
            };
          }

          const outputIndex = args.indexOf('-o');
          const outputTemplate = args[outputIndex + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, '1ti5fvt.mp4'),
            new Uint8Array([1, 2, 3, 4])
          );

          expect(args).toContain(canonicalUrl);
          expect(options.cwd).toBe(tempDirectory);
          return { stdout: '', stderr: '' };
        }
      );
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 701,
      createdAt: '2026-05-20T10:00:00.000Z'
    });
    const memeDispatcher = vi.fn().mockRejectedValue({
      error_code: 413,
      description: 'Request Entity Too Large'
    });
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      execFile,
      env: {
        sqlitePath: path.join(dataDirectory, 'bot.sqlite')
      },
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher,
      memeDispatcher,
      deleteMessageDispatcher,
      now: () => '2026-05-20T10:00:00.000Z'
    });

    await expect(
      orchestrator.handleIncomingMessage(
        createIncomingMessage({
          text: canonicalUrl,
          entities: [],
          messageId: 44,
          chatType: 'supergroup'
        })
      )
    ).resolves.toBeUndefined();

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 44,
      text: 'Видео по ссылке слишком большое: максимум 50 МБ.'
    });
    expect(deleteMessageDispatcher).not.toHaveBeenCalledWith({
      chatId: 1,
      messageId: 44
    });
    expect(db.savedMemePosts).toHaveLength(0);
  });

  test('replies with a duration-specific fallback for overlong direct Reddit videos', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      redditPostResponse({
        id: 'longdirect',
        subreddit: 'ForzaHorizon',
        title: 'long direct video',
        permalink: '/r/ForzaHorizon/comments/longdirect/long_direct_video/',
        ups: 999,
        secure_media: {
          reddit_video: {
            fallback_url: 'https://v.redd.it/longdirect/DASH_720.mp4',
            duration: 601
          }
        }
      })
    );
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 701,
      createdAt: '2026-06-14T12:45:00.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      execFile: vi
        .fn()
        .mockRejectedValue(new DirectVideoTooLongError(601, 600)),
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher,
      memeDispatcher: vi.fn(),
      deleteMessageDispatcher: vi.fn()
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: 'https://www.reddit.com/r/ForzaHorizon/comments/longdirect/long_direct_video/',
        entities: [],
        messageId: 52,
        chatType: 'supergroup'
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 52,
      text: 'Видео по ссылке слишком длинное: максимум 10 мин.'
    });
  });

  test('replies with a size-specific fallback for oversized direct YouTube videos', async () => {
    const db = new FakeDatabaseClient();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 702,
      createdAt: '2026-06-14T12:46:00.000Z'
    });
    const memeDispatcher = vi.fn();
    const deleteMessageDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      execFile: vi
        .fn()
        .mockRejectedValue(
          new DirectVideoTooLargeError(50_000_001, 50_000_000)
        ),
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher,
      memeDispatcher,
      deleteMessageDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        authorizedMode: 'private_link_sender',
        chatType: 'private',
        text: 'https://youtu.be/5sMdQW_YYOo',
        entities: [],
        messageId: 53
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 53,
      text: 'Видео по ссылке слишком большое: максимум 50 МБ.'
    });
    expect(memeDispatcher).not.toHaveBeenCalled();
    expect(deleteMessageDispatcher).not.toHaveBeenCalledWith({
      chatId: 1,
      messageId: 53
    });
  });
});
