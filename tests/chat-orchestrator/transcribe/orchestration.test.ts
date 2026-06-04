import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import type {
  MediaMessageSnapshot,
  StoredMessage
} from '../../../src/domain/models.js';
import {
  createIncomingMessage,
  createOrchestrator,
  FakeDatabaseClient
} from '../support.js';

function createVideoMedia(
  overrides: Partial<MediaMessageSnapshot> = {}
): MediaMessageSnapshot {
  return {
    messageId: 10,
    mediaKind: 'video',
    fileId: 'video-file-id',
    fileUniqueId: 'video-unique-id',
    mimeType: 'video/mp4',
    fileSize: 4,
    durationSeconds: 12,
    caption: null,
    ...overrides
  };
}

function createVideoMessage(
  overrides: Partial<StoredMessage> = {}
): StoredMessage {
  const mediaSnapshot = createVideoMedia({
    messageId: overrides.messageId ?? 10
  });

  return {
    chatId: 1,
    messageId: 10,
    userId: 42,
    senderDisplayName: 'Tom',
    text: '',
    createdAt: '2026-04-13T09:00:00.000Z',
    isBot: false,
    outputMode: 'text',
    replyToMessageId: null,
    mediaSnapshot,
    ...overrides
  };
}

function createTelegramVideoDownloadDeps() {
  const telegramFileApi = {
    getFile: vi.fn().mockResolvedValue({ file_path: 'videos/source.mp4' })
  };
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
    );

  return { telegramFileApi, fetch };
}

describe('ChatOrchestrator /transcribe command', () => {
  test('falls back when /transcribe is not a reply to Telegram video', async () => {
    const db = new FakeDatabaseClient();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/transcribe',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }]
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Сделай reply на видео и отправь /transcribe.'
    });
  });

  test('ignores command arguments and still requires a Telegram video reply', async () => {
    const db = new FakeDatabaseClient();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1006,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/transcribe https://youtu.be/example',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }]
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Сделай reply на видео и отправь /transcribe.'
    });
  });

  test.each([
    ['voice', 'audio/ogg'],
    ['audio', 'audio/mpeg'],
    ['video_note', 'video/mp4']
  ] as const)('falls back when replied-to media is %s', async (mediaKind, mimeType) => {
    const db = new FakeDatabaseClient();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1002,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher
    });
    const media = createVideoMedia({
      mediaKind,
      mimeType
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/transcribe',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }],
        replyToMessageId: 1,
        replyToMediaSnapshot: media
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Сделай reply на видео и отправь /transcribe.'
    });
  });

  test('downloads Telegram video, extracts audio, transcribes it, and replies with transcript', async () => {
    const db = new FakeDatabaseClient({
      messages: [createVideoMessage({ messageId: 10 })]
    });
    const { telegramFileApi, fetch } = createTelegramVideoDownloadDeps();
    let videoInputPath = '';
    let audioOutputPath = '';
    const execFile = vi.fn(
      async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        const inputIndex = args.indexOf('-i');
        videoInputPath =
          inputIndex >= 0 ? (args[inputIndex + 1] ?? '') : videoInputPath;
        const outputPath = args.at(-1);
        if (!outputPath) {
          throw new Error('missing output path');
        }

        audioOutputPath = outputPath;
        await writeFile(path.resolve(outputPath), new Uint8Array([5, 6, 7]));
        return { stdout: '', stderr: '' };
      }
    );
    const transcribe = vi.fn().mockResolvedValue({
      provider: 'gladia',
      providerModel: 'gladia-v2',
      artifact: {
        type: 'transcript',
        transcript: 'текст из видео',
        language: 'ru',
        duration: 12
      },
      rawResponse: { ok: true },
      sourceDurationSeconds: 12
    });
    const replyDispatcher = vi
      .fn()
      .mockResolvedValueOnce({
        messageId: 1003,
        createdAt: '2026-04-13T09:00:05.000Z'
      })
      .mockResolvedValueOnce({
        messageId: 1004,
        createdAt: '2026-04-13T09:00:30.000Z'
      });
    const editMessageTextDispatcher = vi.fn().mockResolvedValue(undefined);
    const deleteMessageDispatcher = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      editMessageTextDispatcher,
      deleteMessageDispatcher,
      telegramFileApi,
      fetch: fetch as typeof globalThis.fetch,
      execFile,
      speechToTextProvider: { transcribe }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 11,
        text: '/transcribe',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }],
        replyToMessageId: 10,
        replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 10),
        replyToMediaSnapshot: createVideoMedia({ messageId: 10 })
      })
    );

    expect(telegramFileApi.getFile).toHaveBeenCalledWith('video-file-id');
    expect(execFile).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-vn', '-c:a', 'libopus']),
      expect.any(Object)
    );
    expect(transcribe).toHaveBeenCalledWith({
      filePath: expect.stringMatching(/transcribe-audio\.ogg$/u),
      filename: 'transcribe-video-10.ogg',
      mimeType: 'audio/ogg',
      timeoutMs: expect.any(Number)
    });
    expect(replyDispatcher).toHaveBeenNthCalledWith(1, {
      chatId: 1,
      replyToMessageId: 11,
      text: 'Слушаю видео'
    });
    expect(editMessageTextDispatcher).toHaveBeenNthCalledWith(1, {
      chatId: 1,
      messageId: 1003,
      text: 'Скачиваю видео'
    });
    expect(editMessageTextDispatcher).toHaveBeenNthCalledWith(2, {
      chatId: 1,
      messageId: 1003,
      text: 'Достаю звук'
    });
    expect(editMessageTextDispatcher).toHaveBeenNthCalledWith(3, {
      chatId: 1,
      messageId: 1003,
      text: 'Распознаю речь'
    });
    expect(editMessageTextDispatcher).toHaveBeenNthCalledWith(4, {
      chatId: 1,
      messageId: 1003,
      text: 'Отправляю расшифровку'
    });
    expect(replyDispatcher).toHaveBeenNthCalledWith(2, {
      chatId: 1,
      replyToMessageId: 11,
      text: 'текст из видео'
    });
    expect(deleteMessageDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      messageId: 1003
    });
    expect(db.getMessageByTelegramMessageId(1, 1004)).toMatchObject({
      text: 'текст из видео',
      isBot: true,
      replyToMessageId: 11
    });
    expect(db.savedMediaArtifacts).toHaveLength(0);
    await expect(readFile(videoInputPath)).rejects.toThrow();
    await expect(readFile(audioOutputPath)).rejects.toThrow();
  });

  test('accepts videos sent by this bot as reply targets', async () => {
    const botVideo = createVideoMessage({
      messageId: 20,
      userId: 77,
      senderDisplayName: 'Fun Bot',
      isBot: true
    });
    const db = new FakeDatabaseClient({ messages: [botVideo] });
    const { telegramFileApi, fetch } = createTelegramVideoDownloadDeps();
    const execFile = vi.fn(
      async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        const outputPath = args.at(-1);
        if (!outputPath) throw new Error('missing output path');
        await writeFile(path.resolve(outputPath), new Uint8Array([5]));
        return { stdout: '', stderr: '' };
      }
    );
    const transcribe = vi.fn().mockResolvedValue({
      provider: 'gladia',
      providerModel: 'gladia-v2',
      artifact: {
        type: 'transcript',
        transcript: 'ботово видео',
        language: 'ru',
        duration: 3
      },
      rawResponse: {},
      sourceDurationSeconds: 3
    });
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1004,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      telegramFileApi,
      fetch: fetch as typeof globalThis.fetch,
      execFile,
      speechToTextProvider: { transcribe }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 21,
        text: '/transcribe',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }],
        replyToMessageId: 20,
        replyToMessageSnapshot: botVideo,
        replyToMediaSnapshot: createVideoMedia({ messageId: 20 })
      })
    );

    expect(transcribe).toHaveBeenCalledOnce();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 21,
      text: 'ботово видео'
    });
  });

  test('sends local failure fallback when transcription fails', async () => {
    const db = new FakeDatabaseClient({
      messages: [createVideoMessage({ messageId: 30 })]
    });
    const { telegramFileApi, fetch } = createTelegramVideoDownloadDeps();
    const execFile = vi.fn(
      async (
        _file: string,
        args: string[]
      ): Promise<{ stdout: string; stderr: string }> => {
        const outputPath = args.at(-1);
        if (!outputPath) throw new Error('missing output path');
        await writeFile(path.resolve(outputPath), new Uint8Array([5]));
        return { stdout: '', stderr: '' };
      }
    );
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1005,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      telegramFileApi,
      fetch: fetch as typeof globalThis.fetch,
      execFile,
      speechToTextProvider: {
        transcribe: vi.fn().mockRejectedValue(new Error('stt down'))
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 31,
        text: '/transcribe',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }],
        replyToMessageId: 30,
        replyToMediaSnapshot: createVideoMedia({ messageId: 30 })
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 31,
      text: 'Не удалось расшифровать видео. Попробуй позже.'
    });
    expect(db.savedMediaArtifacts).toHaveLength(0);
  });
});
