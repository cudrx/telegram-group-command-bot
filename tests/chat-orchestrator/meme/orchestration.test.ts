import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import { createIncomingMessage } from '../../database/support.js';
import { FakeDatabaseClient } from '../support/fake-database.js';
import { createOrchestrator } from '../support/orchestrator.js';

async function writeNormalizedVideo(args: string[]): Promise<{
  stdout: string;
  stderr: string;
}> {
  const outputPath = args.at(-1) ?? '';
  expect(args).toContain('ffmpeg');
  expect(args).toContain('-vf');
  expect(args).toContain('libx264');
  expect(args).toContain('veryfast');
  expect(args).toContain('yuv420p');
  await writeFile(outputPath, new Uint8Array([1, 2, 3]));
  return { stdout: '', stderr: '' };
}

function unsafeVideoProbeResult(): { stdout: string; stderr: string } {
  return {
    stdout: JSON.stringify({
      streams: [
        {
          codec_name: 'h264',
          width: 720,
          height: 1280,
          sample_aspect_ratio: 'N/A',
          display_aspect_ratio: 'N/A',
          pix_fmt: 'yuv420p'
        }
      ]
    }),
    stderr: ''
  };
}

function redditListing(posts: Array<Record<string, unknown>>) {
  return new Response(
    JSON.stringify({
      data: {
        children: posts.map((post) => {
          const subreddit =
            typeof post.subreddit === 'string' ? post.subreddit : 'memes';
          const id = String(post.id ?? 'post');

          return {
            kind: 't3',
            data: {
              subreddit,
              title: 'post title',
              permalink: `/r/${subreddit}/comments/${id}/post_title/`,
              ups: 10,
              over_18: false,
              spoiler: false,
              ...post
            }
          };
        })
      }
    })
  );
}

function blockedRedditListing() {
  return new Response('blocked', { status: 403 });
}

function redirectedResponse(url: string): Response {
  const response = new Response('', { status: 200 });
  Object.defineProperty(response, 'url', { value: url });

  return response;
}

function redditPostResponse(post: Record<string, unknown>) {
  const subreddit =
    typeof post.subreddit === 'string' ? post.subreddit : 'memes';
  const id = String(post.id ?? 'post');

  return new Response(
    JSON.stringify([
      {},
      {
        data: {
          children: [
            {
              kind: 't3',
              data: {
                id,
                subreddit,
                title: 'post title',
                permalink: `/r/${subreddit}/comments/${id}/post_title/`,
                ups: 10,
                over_18: false,
                spoiler: false,
                ...post
              }
            }
          ]
        }
      }
    ])
  );
}

describe('ChatOrchestrator /meme command', () => {
  test('expands a direct Instagram Reel link for private link-only users without saving meme history', async () => {
    let dispatchedFilePath = '';
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'direct-instagram-reel-test-')
    );
    await writeFile(
      path.join(dataDirectory, 'instagram-cookies.txt'),
      '.instagram.com\tTRUE\t/\tTRUE\t2147483647\tsessionid\tabc123'
    );
    const db = new FakeDatabaseClient();
    const execFile = vi
      .fn()
      .mockImplementation(
        async (
          file: string,
          args: string[],
          options?: { cwd?: string | undefined; maxBuffer?: number | undefined }
        ) => {
          if (file === 'yt-dlp' && args.includes('--dump-single-json')) {
            expect(args).toContain(
              'https://www.instagram.com/reel/DYKAmhRu8g-/'
            );

            return {
              stdout: JSON.stringify({
                id: 'DYKAmhRu8g-',
                title: 'Video by bookstasyaa',
                description: 'ОСТАЛОСЬ 3 ДНЯ',
                channel: 'bookstasyaa',
                like_count: 3478,
                duration: 6.8,
                webpage_url: 'https://www.instagram.com/reels/DYKAmhRu8g-/'
              }),
              stderr: ''
            };
          }

          if (file === 'ffprobe') return unsafeVideoProbeResult();

          if (file === 'nice') return writeNormalizedVideo(args);

          expect(file).toBe('yt-dlp');
          const outputIndex = args.indexOf('-o');
          const outputTemplate = args[outputIndex + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, 'DYKAmhRu8g-.mp4'),
            new Uint8Array([1, 2, 3, 4])
          );

          expect(options?.cwd).toBe(tempDirectory);
          expect(args).toContain(
            'bestvideo[protocol=m3u8_native][ext=mp4]+bestaudio[ext=m4a]/bestvideo[protocol^=m3u8][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc1][acodec^=mp4a]/best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best'
          );
          expect(args).toContain('https://www.instagram.com/reel/DYKAmhRu8g-/');
          return { stdout: '', stderr: '' };
        }
      );
    const memeDispatcher = vi.fn().mockImplementation((input) => {
      dispatchedFilePath = input.media.filePath;

      return Promise.resolve({
        messageId: 610,
        createdAt: '2026-05-21T10:00:00.000Z',
        mediaSnapshot: {
          messageId: 610,
          mediaKind: 'video',
          fileId: 'telegram-instagram-video',
          fileUniqueId: 'telegram-instagram-video-unique',
          mimeType: 'video/mp4',
          fileSize: 4,
          durationSeconds: 6.8,
          caption:
            'inst: bookstasyaa · likes: <a href="https://www.instagram.com/reel/DYKAmhRu8g-/">3478</a>'
        }
      });
    });
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
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
      now: () => '2026-05-21T10:00:00.000Z'
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        authorizedMode: 'private_link_sender',
        chatType: 'private',
        text: 'https://www.instagram.com/reel/DYKAmhRu8g-/?igsh=abc',
        entities: [],
        messageId: 43
      })
    );

    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: null,
        reply: false,
        caption:
          'inst: bookstasyaa · likes: <a href="https://www.instagram.com/reel/DYKAmhRu8g-/">3478</a>',
        media: {
          kind: 'video',
          filePath: expect.stringContaining('normalized.mp4')
        }
      })
    );
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      messageId: 43
    });
    expect(db.savedMemePosts).toEqual([]);
    expect(db.getMessageByTelegramMessageId(1, 610)).toMatchObject({
      text: 'inst: bookstasyaa · likes: <a href="https://www.instagram.com/reel/DYKAmhRu8g-/">3478</a>',
      replyToMessageId: null,
      mediaSnapshot: expect.objectContaining({
        mediaKind: 'video',
        caption:
          'inst: bookstasyaa · likes: <a href="https://www.instagram.com/reel/DYKAmhRu8g-/">3478</a>'
      })
    });
    expect(existsSync(dispatchedFilePath)).toBe(false);
  });

  test('expands a direct YouTube Short link like Reels without saving meme history', async () => {
    let dispatchedFilePath = '';
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'direct-youtube-short-test-')
    );
    await writeFile(
      path.join(dataDirectory, 'youtube-cookies.txt'),
      '.youtube.com\tTRUE\t/\tTRUE\t2147483647\tVISITOR_INFO1_LIVE\tabc123'
    );
    const db = new FakeDatabaseClient();
    const execFile = vi
      .fn()
      .mockImplementation(
        async (
          file: string,
          args: string[],
          options?: { cwd?: string | undefined; maxBuffer?: number | undefined }
        ) => {
          if (file === 'yt-dlp' && args.includes('--dump-single-json')) {
            expect(args).toContain('--js-runtimes');
            expect(args).toContain('node');
            expect(args).toContain(
              'https://www.youtube.com/shorts/5sMdQW_YYOo'
            );

            return {
              stdout: JSON.stringify({
                id: '5sMdQW_YYOo',
                title: 'Short title',
                channel: 'cartaxi',
                like_count: 444,
                duration: 11,
                webpage_url: 'https://www.youtube.com/watch?v=5sMdQW_YYOo'
              }),
              stderr: ''
            };
          }

          if (file === 'ffprobe') return unsafeVideoProbeResult();

          if (file === 'nice') return writeNormalizedVideo(args);

          expect(file).toBe('yt-dlp');
          expect(args).toContain('--js-runtimes');
          expect(args).toContain('node');
          const outputIndex = args.indexOf('-o');
          const outputTemplate = args[outputIndex + 1] ?? '';
          const tempDirectory = path.dirname(outputTemplate);
          await writeFile(
            path.join(tempDirectory, '5sMdQW_YYOo.mp4'),
            new Uint8Array([1, 2, 3, 4])
          );

          expect(options?.cwd).toBe(tempDirectory);
          expect(args).toContain(
            'bv*[ext=mp4][vcodec^=avc1][height<=1280]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1][height<=1280]/b[ext=mp4][height<=1280]/b[ext=mp4]'
          );
          expect(args).toContain('-S');
          expect(args).toContain('vcodec:h264,res,ext:mp4:m4a');
          expect(args).toContain('https://www.youtube.com/shorts/5sMdQW_YYOo');
          return { stdout: '', stderr: '' };
        }
      );
    const memeDispatcher = vi.fn().mockImplementation((input) => {
      dispatchedFilePath = input.media.filePath;

      return Promise.resolve({
        messageId: 611,
        createdAt: '2026-05-21T10:00:00.000Z',
        mediaSnapshot: {
          messageId: 611,
          mediaKind: 'video',
          fileId: 'telegram-youtube-video',
          fileUniqueId: 'telegram-youtube-video-unique',
          mimeType: 'video/mp4',
          fileSize: 4,
          durationSeconds: 11,
          caption:
            'yt: cartaxi · likes: <a href="https://www.youtube.com/shorts/5sMdQW_YYOo">444</a>'
        }
      });
    });
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
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
      now: () => '2026-05-21T10:00:00.000Z'
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        authorizedMode: 'private_link_sender',
        chatType: 'private',
        text: 'https://youtu.be/5sMdQW_YYOo',
        entities: [],
        messageId: 44
      })
    );

    expect(memeDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: null,
        reply: false,
        caption:
          'yt: cartaxi · likes: <a href="https://www.youtube.com/shorts/5sMdQW_YYOo">444</a>',
        media: {
          kind: 'video',
          filePath: expect.stringContaining('normalized.mp4')
        }
      })
    );
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      messageId: 44
    });
    expect(db.savedMemePosts).toEqual([]);
    expect(db.getMessageByTelegramMessageId(1, 611)).toMatchObject({
      text: 'yt: cartaxi · likes: <a href="https://www.youtube.com/shorts/5sMdQW_YYOo">444</a>',
      replyToMessageId: null,
      mediaSnapshot: expect.objectContaining({
        mediaKind: 'video',
        caption:
          'yt: cartaxi · likes: <a href="https://www.youtube.com/shorts/5sMdQW_YYOo">444</a>'
      })
    });
    expect(existsSync(dispatchedFilePath)).toBe(false);
  });

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
          if (file === 'ffprobe') return unsafeVideoProbeResult();

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
    expect(execFile).toHaveBeenCalledTimes(4);
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
          if (file === 'ffprobe') return unsafeVideoProbeResult();

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
                duration: 192
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

    expect(execFile).toHaveBeenCalledTimes(4);
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
          if (file === 'ffprobe') return unsafeVideoProbeResult();

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
    expect(execFile).toHaveBeenCalledTimes(4);
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
          if (file === 'ffprobe') return unsafeVideoProbeResult();

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

    expect(execFile).toHaveBeenCalledTimes(4);
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

  test('handles /meme as a command even when the message also contains a Reddit URL', async () => {
    const db = new FakeDatabaseClient();
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
      'https://www.reddit.com/r/BatmanArkham/top/.json?t=week&limit=10',
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
          if (file === 'ffprobe') return unsafeVideoProbeResult();

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

    expect(execFile).toHaveBeenCalledTimes(4);
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
        .mockImplementation(() => Promise.resolve(blockedRedditListing())),
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
        redditListing([
          {
            id: 'cleanup',
            subreddit: 'memes',
            title: 'cleanup',
            url: 'https://i.redd.it/cleanup.jpeg',
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
        redditListing([
          {
            id: 'zero',
            subreddit: 'hmm',
            title: 'zero',
            url: 'https://i.redd.it/zero.jpeg',
            ups: 0
          },
          {
            id: 'low',
            subreddit: 'hmm',
            title: 'low',
            url: 'https://i.redd.it/low.jpeg',
            ups: 9
          }
        ])
      )
      .mockResolvedValueOnce(
        redditListing([
          {
            id: 'fresh',
            subreddit: 'marvelcirclejerk',
            title: 'fresh',
            url: 'https://i.redd.it/fresh.jpeg',
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
        caption: `fresh\n\nr/marvelcirclejerk · <a href="https://www.reddit.com/r/marvelcirclejerk/comments/fresh/post_title/">↑10</a>`
      })
    );
    expect(db.savedMemePosts).toHaveLength(1);
    expect(db.savedMemePosts[0]).toMatchObject({ redditPostId: 'fresh' });
  });
});
