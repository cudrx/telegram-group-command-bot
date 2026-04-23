import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from './support.js';

describe('ChatOrchestrator media image', () => {
  test('reuses cached image OCR and vision description artifacts', async () => {
    const db = new FakeDatabaseClient();
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'cloudflare',
      providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
      artifactKind: 'vision_description',
      artifactStatus: 'success',
      artifactText: 'Cached visual description',
      artifactJson: { response: 'Cached visual description' },
      rawResponseJson: { response: 'Cached visual description' },
      sourceCaption: 'подпись к фото',
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
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'ocr_space',
      providerModel: 'ocr-model',
      artifactKind: 'ocr_text_ru',
      artifactStatus: 'success',
      artifactText: 'ГОРЖУСЬ',
      artifactJson: { text: 'ГОРЖУСЬ' },
      rawResponseJson: { status: 'ok', language: 'rus' },
      sourceCaption: 'подпись к фото',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: 'rus',
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:02.000Z',
      expiresAt: '2026-04-10T12:00:02.000Z'
    });
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'ocr_space',
      providerModel: 'ocr-model',
      artifactKind: 'ocr_text_default',
      artifactStatus: 'success',
      artifactText: 'ГОРЖУСЬ',
      artifactJson: { text: 'ГОРЖУСЬ' },
      rawResponseJson: { status: 'ok', language: null },
      sourceCaption: 'подпись к фото',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:03.000Z',
      expiresAt: '2026-04-10T12:00:03.000Z'
    });

    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('Кэшированная интерпретация'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
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

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к фото'
        }
      })
    );

    expect(generateReply).toHaveBeenCalledTimes(1);
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Кэшированная интерпретация'
    });
  });

  test('heals missing image passes when partial cache exists and only runs missing providers', async () => {
    const db = new FakeDatabaseClient();
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'ocr_space',
      providerModel: 'ocr-model',
      artifactKind: 'ocr_text_ru',
      artifactStatus: 'success',
      artifactText: 'ГОРЖУСЬ',
      artifactJson: { text: 'ГОРЖУСЬ' },
      rawResponseJson: { status: 'ok', language: 'rus' },
      sourceCaption: 'подпись к фото',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: 'rus',
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:02.000Z',
      expiresAt: '2026-04-10T12:00:02.000Z'
    });

    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('Интерпретация из partial cache'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply } as never,
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array([1, 2, 3]))
        ) as typeof fetch,
      visionProvider: {
        describe: vi.fn().mockResolvedValue({
          provider: 'cloudflare',
          providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
          rawText: 'A gold medal with a person at a computer.',
          rawResponse: { response: 'A gold medal with a person at a computer.' }
        })
      },
      ocrProvider: {
        extractText: vi.fn().mockImplementation(async (input) => ({
          provider: 'ocr_space',
          providerModel: 'ocr-model',
          text: 'TEXT DEFAULT',
          language: input.language,
          rawResponse: { status: 'ok', language: input.language }
        }))
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к фото'
        }
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaContext: expect.objectContaining({
          visionDescription: 'A gold medal with a person at a computer.',
          ocrTextRu: 'ГОРЖУСЬ',
          ocrTextDefault: 'TEXT DEFAULT'
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Интерпретация из partial cache'
    });
  });

  test('negative-caches empty OCR results as partial markers and continues with vision description', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('Описание картинки'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array([1, 2, 3]))
        ) as typeof fetch,
      visionProvider: {
        describe: vi.fn().mockResolvedValue({
          provider: 'cloudflare',
          providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
          rawText: 'A gold medal with a person at a computer.',
          rawResponse: { response: 'A gold medal with a person at a computer.' }
        })
      },
      ocrProvider: {
        extractText: vi.fn().mockImplementation(async (input) => ({
          provider: 'ocr_space',
          providerModel: 'ocr-model',
          text: '   \n  ',
          language: input.language,
          rawResponse: { status: 'ok', language: input.language }
        }))
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к фото'
        }
      })
    );

    expect(
      db.savedMediaArtifacts.some(
        (artifact) => artifact.artifactStatus === 'partial'
      )
    ).toBe(true);
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Описание картинки'
    });
  });

  test('heals missing vision description when interpretation is cached and does not rerun OCR', async () => {
    const db = new FakeDatabaseClient();
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'ocr_space',
      providerModel: 'ocr-model',
      artifactKind: 'ocr_text_ru',
      artifactStatus: 'success',
      artifactText: 'ГОРЖУСЬ',
      artifactJson: { text: 'ГОРЖУСЬ' },
      rawResponseJson: { status: 'ok', language: 'rus' },
      sourceCaption: 'подпись к фото',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: 'rus',
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:02.000Z',
      expiresAt: '2026-04-10T12:00:02.000Z'
    });
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'ocr_space',
      providerModel: 'ocr-model',
      artifactKind: 'ocr_text_default',
      artifactStatus: 'success',
      artifactText: 'DEFAULT',
      artifactJson: { text: 'DEFAULT' },
      rawResponseJson: { status: 'ok', language: null },
      sourceCaption: 'подпись к фото',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:02.500Z',
      expiresAt: '2026-04-10T12:00:02.500Z'
    });
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'deepseek',
      providerModel: 'reply-model',
      artifactKind: 'vision_interpretation',
      artifactStatus: 'success',
      artifactText: 'Cached interpretation text',
      artifactJson: { text: 'Cached interpretation text' },
      rawResponseJson: { model: 'reply-model' },
      sourceCaption: 'подпись к фото',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:03.000Z',
      expiresAt: '2026-04-10T12:00:03.000Z'
    });

    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockRejectedValue(new Error('should not call'))
      } as never,
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array([1, 2, 3]))
        ) as typeof fetch,
      visionProvider: {
        describe: vi.fn().mockResolvedValue({
          provider: 'cloudflare',
          providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
          rawText: 'Healed description',
          rawResponse: { response: 'Healed description' }
        })
      },
      ocrProvider: {
        extractText: vi.fn().mockRejectedValue(new Error('should not call'))
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к фото'
        }
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Cached interpretation text'
    });
  });

  test('heals vision description from legacy vision_raw and reuses empty OCR markers', async () => {
    const db = new FakeDatabaseClient();
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'cloudflare',
      providerModel: 'cf-model',
      artifactKind: 'vision_raw',
      artifactStatus: 'success',
      artifactText: 'Legacy raw image description',
      artifactJson: { text: 'Legacy raw image description' },
      rawResponseJson: { response: 'Legacy raw image description' },
      sourceCaption: 'подпись к фото',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:01.000Z',
      expiresAt: '2026-04-10T12:00:01.000Z'
    });

    const generateReply = vi.fn();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply } as never,
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array([1, 2, 3]))
        ) as typeof fetch,
      visionProvider: {
        describe: vi.fn().mockResolvedValue({
          provider: 'cloudflare',
          providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
          rawText: 'Legacy raw image description',
          rawResponse: { response: 'Legacy raw image description' }
        })
      },
      ocrProvider: {
        extractText: vi.fn().mockRejectedValue(new Error('should not call'))
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к фото'
        }
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaContext: expect.objectContaining({
          visionDescription: 'Legacy raw image description'
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Legacy raw image description'
    });
  });

  test('continues when Cloudflare fails but OCR succeeds', async () => {
    const db = new FakeDatabaseClient();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi
          .fn()
          .mockResolvedValue(createReplyResult('Текст с картинки'))
      },
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array([1, 2, 3]))
        ) as typeof fetch,
      visionProvider: {
        describe: vi.fn().mockRejectedValue(new Error('vision down'))
      },
      ocrProvider: {
        extractText: vi.fn().mockImplementation(async (input) => ({
          provider: 'ocr_space',
          providerModel: 'ocr-model',
          text: input.language === 'rus' ? 'РУ ТЕКСТ' : 'DEFAULT TEXT',
          language: input.language,
          rawResponse: { status: 'ok', language: input.language }
        }))
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к фото'
        }
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Текст с картинки'
    });
  });

  test('prefers OCR over vision description when image interpretation is missing', async () => {
    const db = new FakeDatabaseClient();
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'cloudflare',
      providerModel: 'cf-model',
      artifactKind: 'vision_description',
      artifactStatus: 'success',
      artifactText: 'Visual description',
      artifactJson: { text: 'Visual description' },
      rawResponseJson: { response: 'Visual description' },
      sourceCaption: 'подпись к фото',
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
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'ocr_space',
      providerModel: 'ocr-model',
      artifactKind: 'ocr_text_ru',
      artifactStatus: 'success',
      artifactText: 'ГОРЖУСЬ',
      artifactJson: { text: 'ГОРЖУСЬ' },
      rawResponseJson: { status: 'ok', language: 'rus' },
      sourceCaption: 'подпись к фото',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: 'rus',
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:01.500Z',
      expiresAt: '2026-04-10T12:00:01.500Z'
    });

    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('неважно'));
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
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к фото'
        }
      })
    );

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

  test('reads replied image from cached interpretation and heals missing image passes', async () => {
    const db = new FakeDatabaseClient();
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'deepseek',
      providerModel: 'reply-model',
      artifactKind: 'vision_interpretation',
      artifactStatus: 'success',
      artifactText: 'Cached interpretation text',
      artifactJson: { text: 'Cached interpretation text' },
      rawResponseJson: { model: 'reply-model' },
      sourceCaption: 'подпись к фото',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:03.000Z',
      expiresAt: '2026-04-10T12:00:03.000Z'
    });

    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockRejectedValue(new Error('should not call'))
      } as never,
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array([1, 2, 3]))
        ) as typeof fetch,
      visionProvider: {
        describe: vi.fn().mockResolvedValue({
          provider: 'cloudflare',
          providerModel: 'cf-model',
          rawText: 'Healed description',
          rawResponse: { response: 'Healed description' }
        })
      },
      ocrProvider: {
        extractText: vi.fn().mockRejectedValue(new Error('should not call'))
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к фото'
        }
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Cached interpretation text'
    });
  });

  test('returns read failed placeholder when image download fails', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply } as never,
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: vi
        .fn()
        .mockRejectedValue(new Error('download failed')) as typeof fetch,
      visionProvider: { describe: vi.fn() },
      ocrProvider: { extractText: vi.fn() }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к фото'
        }
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Не удалось распознать медиа. Попробуй позже или с другим файлом.'
    });
  });

  test('uses legacy vision_raw when download fails and no new image artifacts exist', async () => {
    const db = new FakeDatabaseClient();
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 90,
      mediaKind: 'photo',
      provider: 'cloudflare',
      providerModel: 'cf-model',
      artifactKind: 'vision_raw',
      artifactStatus: 'success',
      artifactText: 'Legacy raw image description',
      artifactJson: { text: 'Legacy raw image description' },
      rawResponseJson: { response: 'Legacy raw image description' },
      sourceCaption: 'подпись к фото',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:01.000Z',
      expiresAt: '2026-04-10T12:00:01.000Z'
    });

    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() } as never,
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: vi
        .fn()
        .mockRejectedValue(new Error('download failed')) as typeof fetch,
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
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'подпись к фото'
        }
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Legacy raw image description'
    });
  });
});
