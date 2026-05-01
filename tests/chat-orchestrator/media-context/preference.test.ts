import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator media context preference', () => {
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
      replyDispatcher
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
