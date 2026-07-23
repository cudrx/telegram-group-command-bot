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

describe('ChatOrchestrator /meme command — Instagram source lock', () => {
  test('rejects direct Instagram jobs before yt-dlp when the source is locked and cookies are unchanged', async () => {
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'blocked-instagram-reel-test-')
    );
    const cookiesPath = path.join(dataDirectory, 'instagram-cookies.txt');
    await writeFile(
      cookiesPath,
      '.instagram.com\tTRUE\t/\tTRUE\t2147483647\tsessionid\tabc123'
    );
    const cookieStat = await import('node:fs/promises').then(({ stat }) =>
      stat(cookiesPath)
    );
    const db = new FakeDatabaseClient();
    db.saveSourceState({
      sourceKey: 'instagram',
      state: 'blocked',
      reason: 'auth_required',
      blockedAt: '2026-05-21T09:00:00.000Z',
      cookieFileMtimeMsAtBlock: cookieStat.mtimeMs,
      updatedAt: '2026-05-21T09:00:00.000Z'
    });
    const execFile = vi.fn();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 701,
      createdAt: '2026-05-21T10:00:01.000Z'
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
      now: () => '2026-05-21T10:00:00.000Z'
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        authorizedMode: 'private_link_sender',
        chatType: 'private',
        text: 'https://www.instagram.com/reel/DYKAmhRu8g-/?igsh=abc',
        entities: [],
        messageId: 45
      })
    );

    expect(execFile).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 45,
      text: text.meme.instagramUnavailableFallback
    });
  });

  test('rejects queued Instagram jobs at actual start when the source becomes locked while waiting', async () => {
    const firstUpload = createDeferred<void>();
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'queued-instagram-lock-test-')
    );
    const cookiesPath = path.join(dataDirectory, 'instagram-cookies.txt');
    await writeFile(
      cookiesPath,
      '.instagram.com\tTRUE\t/\tTRUE\t2147483647\tsessionid\tabc123'
    );
    const cookieStat = await import('node:fs/promises').then(({ stat }) =>
      stat(cookiesPath)
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
      messageId: 710,
      createdAt: '2026-05-21T10:00:01.000Z'
    });
    const memeDispatcher = vi.fn().mockImplementationOnce(async () => {
      await firstUpload.promise;
      return { messageId: 610, createdAt: '2026-05-21T10:00:00.000Z' };
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
        messageId: 47
      })
    );

    await vi.waitFor(() => {
      expect(memeDispatcher).toHaveBeenCalledTimes(1);
    });
    const execCallsBeforeQueuedJobStarts = execFile.mock.calls.length;

    const secondJob = orchestrator.handleIncomingMessage(
      createIncomingMessage({
        authorizedMode: 'private_link_sender',
        chatType: 'private',
        text: 'https://www.instagram.com/reel/DYKAmhRu8g-/?igsh=def',
        entities: [],
        messageId: 48
      })
    );

    await vi.waitFor(() => {
      expect(replyDispatcher).toHaveBeenCalledWith({
        chatId: 1,
        replyToMessageId: 48,
        text: text.meme.videoQueuedFallback
      });
    });

    db.saveSourceState({
      sourceKey: 'instagram',
      state: 'blocked',
      reason: 'auth_required',
      blockedAt: '2026-05-21T09:59:00.000Z',
      cookieFileMtimeMsAtBlock: cookieStat.mtimeMs,
      updatedAt: '2026-05-21T09:59:00.000Z'
    });
    firstUpload.resolve();

    await firstJob;
    await secondJob;

    expect(execFile).toHaveBeenCalledTimes(execCallsBeforeQueuedJobStarts);
    expect(memeDispatcher).toHaveBeenCalledTimes(1);
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 48,
      text: text.meme.instagramUnavailableFallback
    });
  });

  test('blocks Instagram source after auth-style yt-dlp failure', async () => {
    const dataDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'instagram-lock-on-failure-test-')
    );
    const cookiesPath = path.join(dataDirectory, 'instagram-cookies.txt');
    await writeFile(
      cookiesPath,
      '.instagram.com\tTRUE\t/\tTRUE\t2147483647\tsessionid\tabc123'
    );
    const cookieStat = await import('node:fs/promises').then(({ stat }) =>
      stat(cookiesPath)
    );
    const db = new FakeDatabaseClient();
    const execFile = vi
      .fn()
      .mockRejectedValue(
        new Error(
          [
            'WARNING: [Instagram] Main webpage is locked behind the login page.',
            'ERROR: [Instagram] Requested content is not available, rate-limit reached or login required.'
          ].join('\n')
        )
      );
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 702,
      createdAt: '2026-05-21T10:00:01.000Z'
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
      now: () => '2026-05-21T10:00:00.000Z'
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        authorizedMode: 'private_link_sender',
        chatType: 'private',
        text: 'https://www.instagram.com/reel/DYKAmhRu8g-/?igsh=abc',
        entities: [],
        messageId: 46
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 46,
      text: 'Requested content is not available, rate-limit reached or login required.'
    });
    expect(db.getSourceState('instagram')).toEqual({
      sourceKey: 'instagram',
      state: 'blocked',
      reason: 'auth_required',
      blockedAt: '2026-05-21T10:00:00.000Z',
      cookieFileMtimeMsAtBlock: cookieStat.mtimeMs,
      updatedAt: '2026-05-21T10:00:00.000Z'
    });
  });

  test('replies with the Instagram error text and keeps the source message', async () => {
    const db = new FakeDatabaseClient();
    const instagramError =
      "This content may be inappropriate: It's unavailable for certain audiences. You can manage your sensitive content preferences in Settings.";
    const execFile = vi
      .fn()
      .mockRejectedValue(
        new Error(
          [
            'Command failed: yt-dlp https://www.instagram.com/reel/DbFoLZmNuAt/',
            'WARNING: [Instagram] Video info extraction failed: HTTP Error 400: Bad Request',
            `ERROR: [Instagram] DbFoLZmNuAt: ${instagramError}`
          ].join('\n')
        )
      );
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 703,
      createdAt: '2026-05-21T10:00:01.000Z'
    });
    const deleteMessageDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      execFile,
      qwen: {
        generateReply: vi.fn()
      },
      replyDispatcher,
      deleteMessageDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        authorizedMode: 'private_link_sender',
        chatType: 'private',
        text: 'https://www.instagram.com/reel/DbFoLZmNuAt/',
        entities: [],
        messageId: 47
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 47,
      text: instagramError
    });
    expect(deleteMessageDispatcher).not.toHaveBeenCalledWith({
      chatId: 1,
      messageId: 47
    });
  });
});
