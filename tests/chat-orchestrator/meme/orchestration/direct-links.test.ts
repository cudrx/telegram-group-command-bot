import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createVideoJobQueue } from '../../../../src/app/video-job-queue.js';
import { text } from '../../../../src/locales/locale.js';
import { createIncomingMessage } from '../../../database/support.js';
import { FakeDatabaseClient } from '../../support/fake-database.js';
import { createOrchestrator } from '../../support/orchestrator.js';
import {
  createDeferred,
  videoProbeResult,
  writeNormalizedVideo
} from './support.js';

describe('ChatOrchestrator /meme command — direct links', () => {
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

          if (file === 'ffprobe') return videoProbeResult();

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
        media: expect.objectContaining({
          kind: 'video',
          filePath: expect.stringContaining('normalized.mp4')
        })
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

          if (file === 'ffprobe') return videoProbeResult();

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
            'bv*[ext=mp4][vcodec^=avc1][height<=854]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1][height<=854]/b[ext=mp4][height<=854]/b[ext=mp4]'
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
        media: expect.objectContaining({
          kind: 'video',
          filePath: expect.stringContaining('normalized.mp4')
        })
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

  test('sends a queue notice when a second direct video job waits behind the first in the same chat', async () => {
    const firstUpload = createDeferred<void>();
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'queued-instagram-reel-test-')
    );
    await writeFile(
      path.join(dataDirectory, 'instagram-cookies.txt'),
      '.instagram.com\tTRUE\t/\tTRUE\t2147483647\tsessionid\tabc123'
    );
    const db = new FakeDatabaseClient();
    const execFile = vi.fn().mockImplementation(
      async (
        file: string,
        args: string[],
        options?: {
          cwd?: string | undefined;
          maxBuffer?: number | undefined;
          timeoutMs?: number | undefined;
        }
      ) => {
        if (file === 'yt-dlp' && args.includes('--dump-single-json')) {
          return {
            stdout: JSON.stringify({
              id: 'DYKAmhRu8g-',
              title: 'Video by bookstasyaa',
              channel: 'bookstasyaa',
              like_count: 3478,
              duration: 6.8
            }),
            stderr: ''
          };
        }

        if (file === 'ffprobe') return videoProbeResult();
        if (file === 'nice') return writeNormalizedVideo(args);

        expect(file).toBe('yt-dlp');
        const outputTemplate = args[args.indexOf('-o') + 1] ?? '';
        const tempDirectory = path.dirname(outputTemplate);
        await writeFile(
          path.join(tempDirectory, 'DYKAmhRu8g-.mp4'),
          new Uint8Array([1, 2, 3, 4])
        );
        expect(options?.cwd).toBe(tempDirectory);
        return { stdout: '', stderr: '' };
      }
    );
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 700,
      createdAt: '2026-05-21T10:00:01.000Z'
    });
    const memeDispatcher = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstUpload.promise;
        return { messageId: 610, createdAt: '2026-05-21T10:00:00.000Z' };
      })
      .mockResolvedValueOnce({
        messageId: 611,
        createdAt: '2026-05-21T10:00:02.000Z'
      });
    const orchestrator = createOrchestrator({
      db,
      execFile,
      env: {
        sqlitePath: path.join(dataDirectory, 'bot.sqlite')
      },
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher,
      memeDispatcher,
      videoJobQueue: createVideoJobQueue({
        maxConcurrentJobs: 1,
        maxConcurrentJobsPerChat: 1
      }),
      now: () => '2026-05-21T10:00:00.000Z'
    });

    const firstJob = orchestrator.handleIncomingMessage(
      createIncomingMessage({
        authorizedMode: 'private_link_sender',
        chatType: 'private',
        text: 'https://www.instagram.com/reel/DYKAmhRu8g-/?igsh=abc',
        entities: [],
        messageId: 43
      })
    );

    await vi.waitFor(() => {
      expect(memeDispatcher).toHaveBeenCalledTimes(1);
    });

    const secondJob = orchestrator.handleIncomingMessage(
      createIncomingMessage({
        authorizedMode: 'private_link_sender',
        chatType: 'private',
        text: 'https://www.instagram.com/reel/DYKAmhRu8g-/?igsh=def',
        entities: [],
        messageId: 44
      })
    );

    await vi.waitFor(() => {
      expect(replyDispatcher).toHaveBeenCalledWith({
        chatId: 1,
        replyToMessageId: 44,
        text: text.meme.videoQueuedFallback
      });
    });

    firstUpload.resolve();
    await firstJob;
    await secondJob;

    expect(memeDispatcher).toHaveBeenCalledTimes(2);
  });
});
