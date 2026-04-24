import { describe, expect, test, vi } from 'vitest';

import {
  createOcrProvider,
  createReplyDispatcher,
  createSuccessfulDownloadDeps,
  createVisionProvider
} from '../media-image/support.js';
import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator media context nearby media', () => {
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

  test('summarize does not start missing media read', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
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

    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('summary'));
    const telegramFileApi = { getFile: vi.fn() };
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher: createReplyDispatcher(),
      env: { mediaAnalysisEnabled: true, summarizeContextLimit: 8 },
      telegramFileApi
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 11,
        text: '/summarize',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }]
      })
    );

    expect(telegramFileApi.getFile).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalled();
  });

  test('summarize waits for in-flight media and includes successful summaries', async () => {
    const db = new FakeDatabaseClient();
    const { telegramFileApi, fetch } = createSuccessfulDownloadDeps();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('summary'));
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher: createReplyDispatcher(),
      env: { mediaAnalysisEnabled: true, summarizeContextLimit: 8 },
      visionProvider: createVisionProvider('новая картинка'),
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

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 11,
        text: '/summarize',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }]
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyContext: expect.objectContaining({
          priorContextMessages: expect.arrayContaining([
            expect.objectContaining({
              messageId: 10,
              text: '[media] summary'
            })
          ])
        })
      })
    );
  });
});
