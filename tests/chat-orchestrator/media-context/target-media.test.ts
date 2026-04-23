import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from '../support.js';
import {
  createOcrProvider,
  createReplyDispatcher,
  createSuccessfulDownloadDeps
} from '../media-image/support.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

describe('ChatOrchestrator media context target media', () => {
  test('starts reply typing before target media analysis completes for answer', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'это что на картинке?',
        createdAt: '2026-04-03T12:00:00.000Z',
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

    const visionDeferred = createDeferred<{
      provider: 'cloudflare';
      providerModel: string;
      rawText: string;
      rawResponse: unknown;
    }>();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult('держи'));
    const replyDispatcher = createReplyDispatcher();
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const downloadDeps = createSuccessfulDownloadDeps();
    const visionProvider = {
      describe: vi.fn().mockReturnValue(visionDeferred.promise)
    };
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      sendTyping,
      env: { mediaAnalysisEnabled: true },
      ...downloadDeps,
      visionProvider,
      ocrProvider: createOcrProvider(() => '')
    });

    const handling = orchestrator.handleIncomingMessage(
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
          caption: null
        }
      })
    );

    try {
      await vi.waitFor(() => {
        expect(visionProvider.describe).toHaveBeenCalled();
      });

      expect(sendTyping).toHaveBeenCalledWith(1);
    } finally {
      visionDeferred.resolve({
        provider: 'cloudflare',
        providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
        rawText: 'описание картинки',
        rawResponse: { response: 'описание картинки' }
      });
      await handling;
    }
  });

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
});
