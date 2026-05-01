import { describe, expect, test, vi } from 'vitest';

import { createOrchestrator, FakeDatabaseClient } from '../support.js';
import {
  createOcrProvider,
  createReadImageMessage,
  createReplyDispatcher,
  createReplyResultStub,
  createSuccessfulDownloadDeps,
  createVisionProvider,
  saveOcrArtifact,
  saveVisionInterpretation,
  saveVisionRaw
} from './support.js';

describe('ChatOrchestrator media image healing', () => {
  test('heals missing image passes when partial cache exists and only runs missing providers', async () => {
    const db = new FakeDatabaseClient();
    saveOcrArtifact(db, {
      artifactKind: 'ocr_text_ru',
      text: 'ГОРЖУСЬ',
      language: 'rus'
    });

    const generateReply = createReplyResultStub(
      'Интерпретация из partial cache'
    );
    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply } as never,
      replyDispatcher,
      ...createSuccessfulDownloadDeps(),
      visionProvider: createVisionProvider(
        'A gold medal with a person at a computer.'
      ),
      ocrProvider: createOcrProvider(() => 'TEXT DEFAULT')
    });

    await orchestrator.handleIncomingMessage(createReadImageMessage());

    await vi.waitFor(() => {
      expect(generateReply).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaContext: expect.objectContaining({
            visionDescription: 'A gold medal with a person at a computer.',
            ocrTextRu: 'ГОРЖУСЬ',
            ocrTextDefault: 'TEXT DEFAULT'
          })
        })
      );
    });
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('heals missing vision description when interpretation is cached and does not rerun OCR', async () => {
    const db = new FakeDatabaseClient();
    saveOcrArtifact(db, {
      artifactKind: 'ocr_text_ru',
      text: 'ГОРЖУСЬ',
      language: 'rus'
    });
    saveOcrArtifact(db, {
      artifactKind: 'ocr_text_default',
      text: 'DEFAULT',
      language: null,
      createdAt: '2026-04-03T12:00:02.500Z'
    });
    saveVisionInterpretation(db);

    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockRejectedValue(new Error('should not call'))
      } as never,
      replyDispatcher,
      ...createSuccessfulDownloadDeps(),
      visionProvider: createVisionProvider('Healed description'),
      ocrProvider: {
        extractText: vi.fn().mockRejectedValue(new Error('should not call'))
      }
    });

    await orchestrator.handleIncomingMessage(createReadImageMessage());

    await vi.waitFor(() => {
      expect(db.savedMediaArtifacts).toContainEqual(
        expect.objectContaining({
          artifactKind: 'vision_description',
          artifactText: 'Healed description'
        })
      );
    });
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('heals vision description from legacy vision_raw and reuses empty OCR markers', async () => {
    const db = new FakeDatabaseClient();
    saveVisionRaw(db);

    const generateReply = vi.fn();
    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply } as never,
      replyDispatcher,
      ...createSuccessfulDownloadDeps(),
      visionProvider: createVisionProvider('Legacy raw image description'),
      ocrProvider: {
        extractText: vi.fn().mockRejectedValue(new Error('should not call'))
      }
    });

    await orchestrator.handleIncomingMessage(createReadImageMessage());

    await vi.waitFor(() => {
      expect(generateReply).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaContext: expect.objectContaining({
            visionDescription: 'Legacy raw image description'
          })
        })
      );
    });
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('reads replied image from cached interpretation and heals missing image passes', async () => {
    const db = new FakeDatabaseClient();
    saveVisionInterpretation(db);

    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockRejectedValue(new Error('should not call'))
      } as never,
      replyDispatcher,
      ...createSuccessfulDownloadDeps(),
      visionProvider: createVisionProvider('Healed description'),
      ocrProvider: {
        extractText: vi.fn().mockRejectedValue(new Error('should not call'))
      }
    });

    await orchestrator.handleIncomingMessage(createReadImageMessage());

    await vi.waitFor(() => {
      expect(db.savedMediaArtifacts).toContainEqual(
        expect.objectContaining({
          artifactKind: 'vision_description',
          artifactText: 'Healed description'
        })
      );
    });
    expect(replyDispatcher).not.toHaveBeenCalled();
  });
});
