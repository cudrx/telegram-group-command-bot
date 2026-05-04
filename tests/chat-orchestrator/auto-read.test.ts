import { describe, expect, test, vi } from 'vitest';

import {
  AUTO_READ_FAILED_ARTIFACT_KIND,
  AUTO_READ_FAILED_MODEL,
  AUTO_READ_FAILED_PROVIDER
} from '../../src/app/chat-orchestrator/helpers.js';
import {
  createOcrProvider,
  createReplyDispatcher,
  createSuccessfulDownloadDeps,
  createVisionProvider
} from './media-image/support.js';
import { FakeDatabaseClient } from './support/fake-database.js';
import { createReplyResult } from './support/llm.js';
import { createLogger } from './support/logger.js';
import { createIncomingMessage } from './support/messages.js';
import { createOrchestrator } from './support/orchestrator.js';

describe('auto-read media intake', () => {
  test('retries auto-read before storing a failed artifact', async () => {
    const db = new FakeDatabaseClient();
    const logger = createLogger();
    const telegramFileApi = {
      getFile: vi.fn().mockRejectedValue(new Error('telegram failed'))
    };
    const orchestrator = createOrchestrator({
      db,
      logger,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult('ok'))
      },
      replyDispatcher: createReplyDispatcher(),
      speechToTextProvider: {
        transcribe: vi.fn().mockRejectedValue(new Error('should not call'))
      },
      env: { mediaArtifactRetentionDays: 7 },
      telegramFileApi
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        text: '',
        mediaSnapshot: {
          messageId: 10,
          mediaKind: 'voice',
          fileId: 'voice-file',
          fileUniqueId: 'voice-unique',
          mimeType: 'audio/ogg',
          fileSize: 3,
          durationSeconds: 1,
          caption: 'listen'
        }
      })
    );

    await vi.waitFor(() => {
      expect(db.savedMediaArtifacts).toContainEqual(
        expect.objectContaining({
          fileUniqueId: 'voice-unique',
          chatId: 1,
          telegramMessageId: 10,
          mediaKind: 'voice',
          provider: AUTO_READ_FAILED_PROVIDER,
          providerModel: AUTO_READ_FAILED_MODEL,
          artifactKind: AUTO_READ_FAILED_ARTIFACT_KIND,
          artifactStatus: 'failed',
          artifactText: null,
          artifactJson: null,
          rawResponseJson: null,
          sourceCaption: 'listen',
          sourceMimeType: 'audio/ogg',
          sourceFileSize: 3,
          sourceDurationSeconds: 1,
          recognitionLanguage: null,
          confidenceJson: null,
          createdAt: '2026-04-13T09:00:10.000Z',
          expiresAt: '2026-04-20T09:00:10.000Z'
        })
      );
    });
    expect(db.savedMediaArtifacts[0]?.errorText).toBeTruthy();
    expect(db.savedMediaArtifacts[0]?.errorText?.length).toBeLessThanOrEqual(
      500
    );
    expect(telegramFileApi.getFile).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'media_auto_read_attempt_failed',
      expect.objectContaining({
        attempt: 1,
        mediaKind: 'voice',
        errorMessage: expect.any(String)
      })
    );
    expect(logger.error).toHaveBeenCalledWith(
      'media_auto_read_failed',
      expect.objectContaining({
        mediaKind: 'voice',
        errorMessage: expect.any(String)
      })
    );
  });

  test('does not store a failed artifact when retry succeeds', async () => {
    const db = new FakeDatabaseClient();
    const logger = createLogger();
    const { fetch } = createSuccessfulDownloadDeps();
    const telegramFileApi = {
      getFile: vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary telegram failure'))
        .mockResolvedValueOnce({ file_path: 'voice.ogg' })
    };
    const speechToTextProvider = {
      transcribe: vi.fn().mockResolvedValue({
        provider: 'gladia',
        providerModel: 'gladia-whisper',
        artifact: {
          type: 'transcript',
          transcript: 'hello from voice',
          language: 'ru',
          duration: 1
        },
        rawResponse: { ok: true },
        sourceDurationSeconds: 1
      })
    };
    const orchestrator = createOrchestrator({
      db,
      logger,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult('ok'))
      },
      replyDispatcher: createReplyDispatcher(),
      telegramFileApi,
      fetch,
      speechToTextProvider
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        text: '',
        mediaSnapshot: {
          messageId: 10,
          mediaKind: 'voice',
          fileId: 'voice-file',
          fileUniqueId: 'voice-unique',
          mimeType: 'audio/ogg',
          fileSize: 3,
          durationSeconds: 1,
          caption: null
        }
      })
    );

    await vi.waitFor(() => {
      expect(db.savedMediaArtifacts).toContainEqual(
        expect.objectContaining({
          fileUniqueId: 'voice-unique',
          artifactStatus: 'success',
          artifactText: 'hello from voice'
        })
      );
    });
    expect(telegramFileApi.getFile).toHaveBeenCalledTimes(2);
    expect(
      db.savedMediaArtifacts.some(
        (artifact) => artifact.artifactStatus === 'failed'
      )
    ).toBe(false);
    expect(logger.error).not.toHaveBeenCalledWith(
      'media_auto_read_failed',
      expect.anything()
    );
  });

  test('answer waits for target media and skips LLM after failed required media', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn();
    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      speechToTextProvider: {
        transcribe: vi.fn().mockRejectedValue(new Error('should not call'))
      },
      telegramFileApi: {
        getFile: vi.fn().mockRejectedValue(new Error('download failed'))
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        text: '',
        mediaSnapshot: {
          messageId: 10,
          mediaKind: 'voice',
          fileId: 'voice-file',
          fileUniqueId: 'voice-unique',
          mimeType: 'audio/ogg',
          fileSize: 3,
          durationSeconds: 1,
          caption: null
        }
      })
    );

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 11,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 10,
        replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 10),
        replyToMediaSnapshot:
          db.getMessageByTelegramMessageId(1, 10)?.mediaSnapshot ?? null
      })
    );

    await vi.waitFor(() => {
      expect(db.savedMediaArtifacts).toContainEqual(
        expect.objectContaining({ artifactStatus: 'failed' })
      );
    });
    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('decide waits for context media and skips LLM after failed required media', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn();
    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      speechToTextProvider: {
        transcribe: vi.fn().mockRejectedValue(new Error('should not call'))
      },
      env: { decideContextLimit: 8 },
      telegramFileApi: {
        getFile: vi.fn().mockRejectedValue(new Error('download failed'))
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        text: '',
        mediaSnapshot: {
          messageId: 10,
          mediaKind: 'voice',
          fileId: 'voice-file',
          fileUniqueId: 'voice-unique',
          mimeType: 'audio/ogg',
          fileSize: 3,
          durationSeconds: 1,
          caption: null
        }
      })
    );

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 11,
        text: '/decide',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    await vi.waitFor(() => {
      expect(db.savedMediaArtifacts).toContainEqual(
        expect.objectContaining({ artifactStatus: 'failed' })
      );
    });
    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('starts image processing for an incoming photo without a command or reply', async () => {
    const db = new FakeDatabaseClient();
    const { telegramFileApi, fetch } = createSuccessfulDownloadDeps();
    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult('ok'))
      },
      replyDispatcher,
      visionProvider: createVisionProvider('a photo'),
      ocrProvider: createOcrProvider(() => ''),
      telegramFileApi,
      fetch
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        text: '',
        mediaSnapshot: {
          messageId: 10,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: null,
          fileSize: 3,
          durationSeconds: null,
          caption: null
        }
      })
    );

    await vi.waitFor(() => {
      expect(db.savedMediaArtifacts).toContainEqual(
        expect.objectContaining({
          fileUniqueId: 'photo-unique',
          artifactStatus: 'success'
        })
      );
    });
    expect(telegramFileApi.getFile).toHaveBeenCalledWith('photo-file');
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('does not start auto-read when no image provider is configured', async () => {
    const db = new FakeDatabaseClient();
    const { telegramFileApi, fetch } = createSuccessfulDownloadDeps();
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult('ok'))
      },
      replyDispatcher: createReplyDispatcher(),
      telegramFileApi,
      fetch
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        text: '',
        mediaSnapshot: {
          messageId: 10,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: null,
          fileSize: 3,
          durationSeconds: null,
          caption: null
        }
      })
    );

    expect(telegramFileApi.getFile).not.toHaveBeenCalled();
    expect(db.savedMediaArtifacts).toEqual([]);
  });

  test('skips album video and starts on first album image', async () => {
    const db = new FakeDatabaseClient();
    const { telegramFileApi, fetch } = createSuccessfulDownloadDeps();
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult('ok'))
      },
      replyDispatcher: createReplyDispatcher(),
      visionProvider: createVisionProvider('a photo'),
      ocrProvider: createOcrProvider(() => ''),
      telegramFileApi,
      fetch
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        text: '',
        mediaGroupId: 'album-1',
        mediaSnapshot: {
          messageId: 10,
          mediaKind: 'video_note',
          fileId: 'video-file',
          fileUniqueId: 'video-unique',
          mimeType: 'video/mp4',
          fileSize: 3,
          durationSeconds: 1,
          caption: null
        }
      })
    );

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 11,
        text: '',
        mediaGroupId: 'album-1',
        mediaSnapshot: {
          messageId: 11,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: null,
          fileSize: 3,
          durationSeconds: null,
          caption: null
        }
      })
    );

    await vi.waitFor(() => {
      expect(telegramFileApi.getFile).toHaveBeenCalledTimes(1);
    });
    expect(telegramFileApi.getFile).toHaveBeenCalledWith('photo-file');
  });

  test('skips later album images after first image starts', async () => {
    const db = new FakeDatabaseClient();
    const { telegramFileApi, fetch } = createSuccessfulDownloadDeps();
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult('ok'))
      },
      replyDispatcher: createReplyDispatcher(),
      visionProvider: createVisionProvider('first photo'),
      ocrProvider: createOcrProvider(() => ''),
      telegramFileApi,
      fetch
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 11,
        text: '',
        mediaGroupId: 'album-1',
        mediaSnapshot: {
          messageId: 11,
          mediaKind: 'photo',
          fileId: 'first-photo-file',
          fileUniqueId: 'first-photo-unique',
          mimeType: null,
          fileSize: 3,
          durationSeconds: null,
          caption: null
        }
      })
    );

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 12,
        text: '',
        mediaGroupId: 'album-1',
        mediaSnapshot: {
          messageId: 12,
          mediaKind: 'photo',
          fileId: 'second-photo-file',
          fileUniqueId: 'second-photo-unique',
          mimeType: null,
          fileSize: 3,
          durationSeconds: null,
          caption: null
        }
      })
    );

    await vi.waitFor(() => {
      expect(telegramFileApi.getFile).toHaveBeenCalledTimes(1);
    });
    expect(telegramFileApi.getFile).toHaveBeenCalledWith('first-photo-file');
  });

  test('forgets album image keys after the dedupe ttl', async () => {
    const db = new FakeDatabaseClient();
    const { telegramFileApi, fetch } = createSuccessfulDownloadDeps();
    let nowMs = Date.parse('2026-04-13T09:00:00.000Z');
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult('ok'))
      },
      replyDispatcher: createReplyDispatcher(),
      visionProvider: createVisionProvider('photo'),
      ocrProvider: createOcrProvider(() => ''),
      telegramFileApi,
      fetch,
      now: () => new Date(nowMs).toISOString()
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 11,
        text: '',
        mediaGroupId: 'album-1',
        mediaSnapshot: {
          messageId: 11,
          mediaKind: 'photo',
          fileId: 'first-photo-file',
          fileUniqueId: 'first-photo-unique',
          mimeType: null,
          fileSize: 3,
          durationSeconds: null,
          caption: null
        }
      })
    );

    nowMs += 25 * 60 * 60 * 1000;

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 12,
        text: '',
        mediaGroupId: 'album-1',
        mediaSnapshot: {
          messageId: 12,
          mediaKind: 'photo',
          fileId: 'next-day-photo-file',
          fileUniqueId: 'next-day-photo-unique',
          mimeType: null,
          fileSize: 3,
          durationSeconds: null,
          caption: null
        }
      })
    );

    await vi.waitFor(() => {
      expect(telegramFileApi.getFile).toHaveBeenCalledTimes(2);
    });
    expect(telegramFileApi.getFile).toHaveBeenLastCalledWith(
      'next-day-photo-file'
    );
  });
});
