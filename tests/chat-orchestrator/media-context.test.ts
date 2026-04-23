import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from './support.js';

describe('ChatOrchestrator media context', () => {
  test('does not download target media for /answer when media analysis is disabled', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'это вообще правда?',
        createdAt: '2026-04-03T12:00:00.000Z',
        mediaSnapshot: {
          messageId: 1,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к мему'
        }
      })
    );

    const generateReply = vi.fn().mockResolvedValue(createReplyResult('держи'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      env: { mediaAnalysisEnabled: false },
      telegramFileApi: {
        getFile: vi.fn().mockRejectedValue(new Error('should not call'))
      },
      fetch: vi
        .fn()
        .mockRejectedValue(new Error('should not call')) as typeof fetch,
      visionProvider: {
        describe: vi.fn().mockRejectedValue(new Error('should not call'))
      },
      ocrProvider: {
        extractText: vi.fn().mockRejectedValue(new Error('should not call'))
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 1,
        replyToMediaSnapshot: {
          messageId: 1,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к мему'
        }
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'answer',
        mediaContext: null
      })
    );
  });

  test('passes target media context into answer generation', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'это вообще правда?',
        createdAt: '2026-04-03T12:00:00.000Z',
        mediaSnapshot: {
          messageId: 1,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к мему'
        }
      })
    );
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 1,
      mediaKind: 'photo',
      provider: 'cloudflare',
      providerModel: 'cf-model',
      artifactKind: 'vision_description',
      artifactStatus: 'success',
      artifactText: 'Raw image description',
      artifactJson: { text: 'Raw image description' },
      rawResponseJson: { response: 'Raw image description' },
      sourceCaption: 'подпись к мему',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:01.000Z',
      expiresAt: '2026-04-10T12:00:01.000Z'
    });
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 1,
      mediaKind: 'photo',
      provider: 'deepseek',
      providerModel: 'reply-model',
      artifactKind: 'vision_interpretation',
      artifactStatus: 'success',
      artifactText: 'Interpreted image context',
      artifactJson: { text: 'Interpreted image context' },
      rawResponseJson: { model: 'reply-model' },
      sourceCaption: 'подпись к мему',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:02.000Z',
      expiresAt: '2026-04-10T12:00:02.000Z'
    });
    const generateReply = vi.fn().mockResolvedValue(createReplyResult('держи'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      env: { mediaAnalysisEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 1,
        replyToMediaSnapshot: {
          messageId: 1,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к мему'
        }
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'answer',
        mediaContext: {
          sourceCaption: 'подпись к мему',
          visionDescription: 'Raw image description',
          ocrTextRu: null,
          ocrTextDefault: null,
          visionRaw: null,
          visionInterpretation: 'Interpreted image context',
          audioTranscript: null
        }
      })
    );
  });

  test('includes cached nearby media context in answer prompt input', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: '',
        createdAt: '2026-04-03T11:58:00.000Z',
        mediaSnapshot: {
          messageId: 1,
          mediaKind: 'voice',
          fileId: 'voice-file',
          fileUniqueId: 'voice-unique',
          mimeType: 'audio/ogg',
          fileSize: 3,
          durationSeconds: 3,
          caption: null
        }
      })
    );
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: 'что скажешь?',
        createdAt: '2026-04-03T11:59:00.000Z'
      })
    );
    db.saveMediaArtifact({
      fileUniqueId: 'voice-unique',
      chatId: 1,
      telegramMessageId: 1,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: 'привет из прошлого войса',
      artifactJson: {
        type: 'transcript',
        transcript: 'привет из прошлого войса',
        language: 'ru',
        duration: 3
      },
      rawResponseJson: { status: 'done' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 3,
      sourceDurationSeconds: 3,
      recognitionLanguage: 'ru',
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T11:58:10.000Z',
      expiresAt: '2026-04-10T11:58:10.000Z'
    });
    const generateReply = vi.fn().mockResolvedValue(createReplyResult('держи'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      env: { mediaAnalysisEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 3,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 2
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyContext: expect.objectContaining({
          priorContextMessages: expect.arrayContaining([
            expect.objectContaining({
              messageId: 1,
              text: '[media] привет из прошлого войса'
            })
          ])
        })
      })
    );
  });

  test('prefers OCR over vision description for nearby image summaries', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: '',
        createdAt: '2026-04-03T11:58:00.000Z',
        mediaSnapshot: {
          messageId: 1,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: null
        }
      })
    );
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: 'что скажешь?',
        createdAt: '2026-04-03T11:59:00.000Z'
      })
    );
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 1,
      mediaKind: 'photo',
      provider: 'cloudflare',
      providerModel: 'cf-model',
      artifactKind: 'vision_description',
      artifactStatus: 'success',
      artifactText: 'A gold medal with a person at a computer.',
      artifactJson: { text: 'A gold medal with a person at a computer.' },
      rawResponseJson: {
        response: 'A gold medal with a person at a computer.'
      },
      sourceCaption: null,
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T11:58:10.000Z',
      expiresAt: '2026-04-10T11:58:10.000Z'
    });
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 1,
      mediaKind: 'photo',
      provider: 'ocr_space',
      providerModel: 'ocr-model',
      artifactKind: 'ocr_text_ru',
      artifactStatus: 'success',
      artifactText: 'ГОРЖУСЬ',
      artifactJson: { text: 'ГОРЖУСЬ' },
      rawResponseJson: { status: 'ok', language: 'rus' },
      sourceCaption: null,
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: 'rus',
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T11:58:11.000Z',
      expiresAt: '2026-04-10T11:58:11.000Z'
    });
    const generateReply = vi.fn().mockResolvedValue(createReplyResult('держи'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      env: { mediaAnalysisEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 3,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 2
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyContext: expect.objectContaining({
          priorContextMessages: expect.arrayContaining([
            expect.objectContaining({
              messageId: 1,
              text: '[media] ГОРЖУСЬ'
            })
          ])
        })
      })
    );
  });
});
