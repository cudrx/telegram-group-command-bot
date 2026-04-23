import { describe, expect, test, vi } from 'vitest';

import { createOrchestrator, FakeDatabaseClient } from '../support.js';
import {
  createReadImageMessage,
  createReplyDispatcher,
  createReplyResultStub,
  saveOcrArtifact,
  saveVisionDescription
} from './support.js';

describe('ChatOrchestrator media image cache', () => {
  test('reuses cached image OCR and vision description artifacts', async () => {
    const db = new FakeDatabaseClient();
    saveVisionDescription(db, 'Cached visual description');
    saveOcrArtifact(db, {
      artifactKind: 'ocr_text_ru',
      text: 'ГОРЖУСЬ',
      language: 'rus'
    });
    saveOcrArtifact(db, {
      artifactKind: 'ocr_text_default',
      text: 'ГОРЖУСЬ',
      language: null,
      createdAt: '2026-04-03T12:00:03.000Z'
    });

    const generateReply = createReplyResultStub('Кэшированная интерпретация');
    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply } as never,
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
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

    await orchestrator.handleIncomingMessage(createReadImageMessage());

    expect(generateReply).toHaveBeenCalledTimes(1);
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Кэшированная интерпретация'
    });
  });

  test('prefers OCR over vision description when image interpretation is missing', async () => {
    const db = new FakeDatabaseClient();
    saveVisionDescription(db, 'Visual description');
    saveOcrArtifact(db, {
      artifactKind: 'ocr_text_ru',
      text: 'ГОРЖУСЬ',
      language: 'rus',
      createdAt: '2026-04-03T12:00:01.500Z'
    });

    const generateReply = createReplyResultStub('неважно');
    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      env: { mediaAnalysisEnabled: true }
    });

    await orchestrator.handleIncomingMessage(createReadImageMessage());

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaContext: expect.objectContaining({
          visionDescription: 'Visual description',
          ocrTextRu: 'ГОРЖУСЬ'
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'неважно'
    });
  });
});
