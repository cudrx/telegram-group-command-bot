import { describe, expect, test, vi } from 'vitest';

import { language } from '../../../src/locales/locale.js';
import { createOrchestrator, FakeDatabaseClient } from '../support.js';
import {
  createOcrProvider,
  createReadImageMessage,
  createReplyDispatcher,
  createReplyResultStub,
  createSuccessfulDownloadDeps,
  createVisionProvider
} from './support.js';

describe('ChatOrchestrator media image analysis', () => {
  test('negative-caches empty OCR results as partial markers and continues with vision description', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = createReplyResultStub('Описание картинки');
    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      ...createSuccessfulDownloadDeps(),
      visionProvider: createVisionProvider(
        'A gold medal with a person at a computer.'
      ),
      ocrProvider: createOcrProvider(() => '   \n  ')
    });

    await orchestrator.handleIncomingMessage(createReadImageMessage());

    await vi.waitFor(() => {
      expect(
        db.savedMediaArtifacts.some(
          (artifact) => artifact.artifactStatus === 'partial'
        )
      ).toBe(true);
      expect(db.savedMediaArtifacts).toContainEqual(
        expect.objectContaining({
          artifactKind: 'vision_interpretation',
          artifactText: 'Описание картинки'
        })
      );
    });
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('continues when Cloudflare fails but OCR succeeds', async () => {
    const db = new FakeDatabaseClient();
    const replyDispatcher = createReplyDispatcher();
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: createReplyResultStub('Текст с картинки')
      },
      replyDispatcher,
      ...createSuccessfulDownloadDeps(),
      visionProvider: {
        describe: vi.fn().mockRejectedValue(new Error('vision down'))
      },
      ocrProvider: createOcrProvider((ocrLanguage) =>
        ocrLanguage === language.ocrProviderLanguageCode
          ? 'РУ ТЕКСТ'
          : 'DEFAULT TEXT'
      )
    });

    await orchestrator.handleIncomingMessage(createReadImageMessage());

    await vi.waitFor(() => {
      expect(db.savedMediaArtifacts).toContainEqual(
        expect.objectContaining({
          artifactKind: 'vision_interpretation',
          artifactText: 'Текст с картинки'
        })
      );
    });
    expect(replyDispatcher).not.toHaveBeenCalled();
  });
});
