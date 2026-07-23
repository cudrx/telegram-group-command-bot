import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createIncomingMessage } from '../../../database/support.js';
import { FakeDatabaseClient } from '../../support/fake-database.js';
import { createOrchestrator } from '../../support/orchestrator.js';
import {
  redditPostResponse,
  redirectedResponse,
  videoProbeResult,
  writeNormalizedVideo
} from './support.js';

describe('ChatOrchestrator /meme command — direct Reddit media', () => {
  test('expands a direct Reddit image link with the standard meme caption', async () => {
    let dispatchedFilePath = '';
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditPostResponse({
          id: 'imgdirect',
          subreddit: 'memes',
          title: 'direct image',
          permalink: '/r/memes/comments/imgdirect/direct_image/',
          ups: 1234,
          url: 'https://i.redd.it/direct-image.jpeg'
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Length': '3' }
        })
      );
    const memeDispatcher = vi.fn().mockImplementation((input) => {
      dispatchedFilePath = input.media.filePath;

      return Promise.resolve({
        messageId: 515,
        createdAt: '2026-05-22T10:00:00.000Z'
      });
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
      deleteMessageDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: 'https://www.reddit.com/r/memes/comments/imgdirect/direct_image/',
        entities: [],
        messageId: 47,
        chatType: 'supergroup'
      })
    );

    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: null,
        reply: false,
        caption:
          'direct image\n\nr/memes · <a href="https://www.reddit.com/r/memes/comments/imgdirect/direct_image/">↑1234</a>',
        media: expect.objectContaining({ kind: 'image' })
      })
    );
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      messageId: 47
    });
    expect(db.savedMemePosts[0]).toMatchObject({
      redditPostId: 'imgdirect',
      mediaKind: 'image',
      mediaUrl: 'https://i.redd.it/direct-image.jpeg'
    });
    expect(dispatchedFilePath).not.toBe('');
    expect(existsSync(dispatchedFilePath)).toBe(false);
  });

  test('expands a direct Reddit gallery link and marks every item as spoiler', async () => {
    const dispatchedFilePaths: string[] = [];
    const db = new FakeDatabaseClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        redditPostResponse({
          id: 'galdirect',
          subreddit: 'pics',
          title: 'direct gallery',
          permalink: '/r/pics/comments/galdirect/direct_gallery/',
          ups: 4321,
          spoiler: true,
          is_gallery: true,
          gallery_data: {
            items: [{ media_id: 'a1' }, { media_id: 'b2' }]
          },
          media_metadata: {
            a1: {
              status: 'valid',
              m: 'image/jpg',
              s: {
                u: 'https://preview.redd.it/a1.jpg?width=640&amp;format=pjpg'
              }
            },
            b2: {
              status: 'valid',
              m: 'image/png',
              s: {
                u: 'https://preview.redd.it/b2.png?width=640&amp;format=png'
              }
            }
          }
        })
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
    const memeDispatcher = vi.fn().mockImplementation((input) => {
      dispatchedFilePaths.push(
        ...input.media.items.map((item: { filePath: string }) => item.filePath)
      );

      return Promise.resolve({
        messageId: 516,
        createdAt: '2026-05-22T10:00:00.000Z'
      });
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
      deleteMessageDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: 'https://www.reddit.com/r/pics/comments/galdirect/direct_gallery/',
        entities: [],
        messageId: 48,
        chatType: 'supergroup'
      })
    );

    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: null,
        reply: false,
        hasSpoiler: true,
        caption:
          'direct gallery\n\nr/pics · <a href="https://www.reddit.com/r/pics/comments/galdirect/direct_gallery/">↑4321</a>',
        media: {
          kind: 'gallery',
          items: [
            expect.objectContaining({ hasSpoiler: true }),
            expect.objectContaining({ hasSpoiler: true })
          ]
        }
      })
    );
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      messageId: 48
    });
    expect(db.savedMemePosts[0]).toMatchObject({
      redditPostId: 'galdirect',
      mediaKind: 'gallery',
      mediaUrl: null
    });
    expect(dispatchedFilePaths).toHaveLength(2);
    expect(dispatchedFilePaths.every((filePath) => !existsSync(filePath))).toBe(
      true
    );
  });

  test('ignores direct Reddit self text links without deleting the source message', async () => {
    const db = new FakeDatabaseClient();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      redditPostResponse({
        id: 'selfdirect',
        is_self: true,
        selftext: 'text only',
        url: 'https://www.reddit.com/r/memes/comments/selfdirect/text_only/'
      })
    );
    const memeDispatcher = vi.fn();
    const deleteMessageDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher: vi.fn(),
      memeDispatcher,
      deleteMessageDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: 'https://www.reddit.com/r/memes/comments/selfdirect/text_only/',
        entities: [],
        messageId: 49,
        chatType: 'supergroup'
      })
    );

    expect(memeDispatcher).not.toHaveBeenCalled();
    expect(deleteMessageDispatcher).not.toHaveBeenCalled();
    expect(db.savedMemePosts).toEqual([]);
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
          if (file === 'ffprobe') return videoProbeResult();

          if (file === 'nice') return writeNormalizedVideo(args);

          expect(file).toBe('yt-dlp');

          if (args.includes('--dump-single-json')) {
            return {
              stdout: JSON.stringify({
                id: 'vp5yv91as62h1',
                title: 'AI vs Creativity from yt-dlp',
                webpage_url:
                  'https://www.reddit.com/r/SipsTea/comments/1ti5fvt/ai_vs_creativity_from_a_proai_greedy_corpo/',
                like_count: 661,
                duration: 19
              }),
              stderr: ''
            };
          }

          const outputIndex = args.indexOf('-o');
          expect(outputIndex).toBeGreaterThanOrEqual(0);
          expect(args).toContain('/app/data/reddit-cookies.txt');
          expect(args).toContain(
            'bestvideo[protocol=m3u8_native][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best'
          );

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

    expect(execFile).toHaveBeenCalledTimes(5);
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: null,
        reply: false,
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

  test('expands a Reddit share link through its canonical post redirect', async () => {
    let dispatchedFilePath = '';
    const db = new FakeDatabaseClient();
    const canonicalUrl =
      'https://www.reddit.com/r/nextfuckinglevel/comments/1tja210/the_bubba_scrub_invented_under_pressure_by_james/';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirectedResponse(`${canonicalUrl}?share_id=abc`))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {},
            {
              data: {
                children: [
                  {
                    data: {
                      id: '1tja210',
                      subreddit: 'nextfuckinglevel',
                      title: 'The Bubba Scrub invented under pressure',
                      permalink:
                        '/r/nextfuckinglevel/comments/1tja210/the_bubba_scrub_invented_under_pressure_by_james/',
                      ups: 9001,
                      over_18: false,
                      spoiler: false,
                      secure_media: {
                        reddit_video: {
                          fallback_url:
                            'https://v.redd.it/bubba/DASH_720.mp4?source=fallback',
                          duration: 17
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
                id: '1tja210',
                title: 'The Bubba Scrub invented under pressure',
                like_count: 9001,
                duration: 17
              }),
              stderr: ''
            };
          }

          const outputIndex = args.indexOf('-o');
          const outputTemplate = args[outputIndex + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, '1tja210.mp4'),
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
        messageId: 513,
        createdAt: '2026-05-21T10:00:00.000Z'
      });
    });
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      fetch: fetchMock,
      execFile,
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher: vi.fn(),
      memeDispatcher,
      deleteMessageDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: 'https://www.reddit.com/r/nextfuckinglevel/s/WKonIxZF1P',
        entities: [],
        messageId: 45,
        chatType: 'supergroup'
      })
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://www.reddit.com/r/nextfuckinglevel/s/WKonIxZF1P',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://www.reddit.com/r/nextfuckinglevel/comments/1tja210/the_bubba_scrub_invented_under_pressure_by_james/.json',
      expect.any(Object)
    );
    expect(execFile).toHaveBeenCalledTimes(5);
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: null,
        reply: false,
        caption:
          'The Bubba Scrub invented under pressure\n\nr/nextfuckinglevel · <a href="https://www.reddit.com/r/nextfuckinglevel/comments/1tja210/the_bubba_scrub_invented_under_pressure_by_james/">↑9001</a>',
        media: expect.objectContaining({ kind: 'video' })
      })
    );
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      messageId: 45
    });
    expect(dispatchedFilePath).not.toBe('');
    expect(existsSync(dispatchedFilePath)).toBe(false);
  });

  test('falls back to yt-dlp when a Reddit share link resolves but JSON is blocked', async () => {
    let dispatchedFilePath = '';
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'reddit-share-ytdlp-test-')
    );
    await writeFile(
      path.join(dataDirectory, 'reddit-cookies.txt'),
      '.reddit.com\tTRUE\t/\tTRUE\t2147483647\treddit_session\tabc123'
    );
    const db = new FakeDatabaseClient();
    const canonicalUrl =
      'https://www.reddit.com/r/nextfuckinglevel/comments/1tja210/the_bubba_scrub_invented_under_pressure_by_james/';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirectedResponse(`${canonicalUrl}?share_id=abc`))
      .mockResolvedValueOnce(new Response('blocked', { status: 403 }))
      .mockResolvedValueOnce(
        redirectedResponse(`${canonicalUrl}?share_id=abc`)
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
                id: '1tja210',
                title: 'The Bubba Scrub from yt-dlp',
                like_count: 777,
                duration: 18
              }),
              stderr: ''
            };
          }

          const outputIndex = args.indexOf('-o');
          const outputTemplate = args[outputIndex + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, '1tja210.mp4'),
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
        messageId: 514,
        createdAt: '2026-05-21T10:00:00.000Z'
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
      deleteMessageDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: 'https://www.reddit.com/r/nextfuckinglevel/s/WKonIxZF1P',
        entities: [],
        messageId: 46,
        chatType: 'supergroup'
      })
    );

    expect(execFile).toHaveBeenCalledTimes(5);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://www.reddit.com/r/nextfuckinglevel/s/WKonIxZF1P',
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'reddit_session=abc123'
        })
      })
    );
    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: null,
        reply: false,
        caption:
          'The Bubba Scrub from yt-dlp\n\nr/nextfuckinglevel · <a href="https://www.reddit.com/r/nextfuckinglevel/comments/1tja210/the_bubba_scrub_invented_under_pressure_by_james/">↑777</a>',
        media: expect.objectContaining({ kind: 'video' })
      })
    );
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      messageId: 46
    });
    expect(dispatchedFilePath).not.toBe('');
    expect(existsSync(dispatchedFilePath)).toBe(false);
  });
});
