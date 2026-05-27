import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createLogger,
  createLookupPlanResult,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator translate command', () => {
  test('returns usage placeholder when no usable reply target exists', async () => {
    const db = new FakeDatabaseClient();
    const logger = createLogger();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult('нет'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      logger,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/translate',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Сделай reply на сообщение и отправь /translate.'
    });
    expect(logger.warn).not.toHaveBeenCalledWith(
      'translate_anchor_missing',
      expect.anything()
    );
  });

  test('returns local placeholder when target text already looks like target language', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'Привет, как дела?',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );
    const generateReply = vi.fn().mockResolvedValue(createReplyResult('нет'));
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
        messageId: 2,
        text: '/translate',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }],
        replyToMessageId: 1,
        replyToUserId: 42
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Похоже, это уже на русском.'
    });
  });

  test('sends non-target-language text to the LLM as a labeled block', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'Hello world',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('Текст сообщения:\nПривет, мир'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const planLookup = vi.fn().mockResolvedValue(
      createLookupPlanResult({
        shouldLookup: true,
        purpose: 'entity_grounding',
        reason: 'should not be called',
        queries: ['Hello world'],
        confidence: 'high'
      })
    );
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      lookupProvider: {
        search: vi.fn().mockRejectedValue(new Error('should not lookup'))
      },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/translate ignored',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }],
        replyToMessageId: 1,
        replyToUserId: 42
      })
    );

    expect(planLookup).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'translate',
        lookupContext: null,
        mediaContext: null,
        replyContext: expect.objectContaining({
          replyAnchorMessage: expect.objectContaining({
            messageId: 1,
            text: 'Текст сообщения:\nHello world'
          })
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: '<b>Текст сообщения:</b>\nПривет, мир'
    });
  });

  test('normalizes escaped newlines in translate LLM output before sending', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'Scan this lecturer',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );
    const generateReply = vi
      .fn()
      .mockResolvedValue(
        createReplyResult(
          'Текст на картинке: \\n Отсканируй этого препода \\n и скажи мне'
        )
      );
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
        messageId: 2,
        text: '/translate',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }],
        replyToMessageId: 1,
        replyToUserId: 42
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: '<b>Текст на картинке:</b>\nОтсканируй этого препода\nи скажи мне'
    });
  });

  test('allows translate to target this bot own previous message', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        fromUserId: 77,
        fromUsername: 'fun_bot',
        fromDisplayName: 'Fun Bot',
        isBot: true,
        text: 'Text on image:\nScan this lecturer',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );
    const generateReply = vi
      .fn()
      .mockResolvedValue(
        createReplyResult('Текст сообщения:\nТекст на картинке')
      );
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
        messageId: 2,
        text: '/translate',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }],
        replyToMessageId: 1,
        replyToUserId: 77
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'translate',
        replyContext: expect.objectContaining({
          replyAnchorMessage: expect.objectContaining({
            messageId: 1,
            userId: 77,
            isBot: true,
            text: 'Текст сообщения:\nText on image:\nScan this lecturer'
          })
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: '<b>Текст сообщения:</b>\nТекст на картинке'
    });
  });

  test('formats translate block headers in bold with blank lines between blocks', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'caption',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );
    const generateReply = vi
      .fn()
      .mockResolvedValue(
        createReplyResult(
          [
            'Текст на картинке:',
            'ШАКАЛ ПОСЛЕ ТОГО, КАК ЗАЯВИЛСЯ В',
            'КОНКУРС «ЛЮБЛЮ ГВЕН СТЭЙСИ»,',
            'Подпись:',
            'И всё это ради самой посредственной любовной линии в истории'
          ].join('\n')
        )
      );
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
        messageId: 2,
        text: '/translate',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }],
        replyToMessageId: 1,
        replyToUserId: 42
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: [
        '<b>Текст на картинке:</b>',
        'ШАКАЛ ПОСЛЕ ТОГО, КАК ЗАЯВИЛСЯ В',
        'КОНКУРС «ЛЮБЛЮ ГВЕН СТЭЙСИ»,',
        '',
        '<b>Подпись:</b>',
        'И всё это ради самой посредственной любовной линии в истории'
      ].join('\n')
    });
  });

  test('omits target-language media caption and translates non-target-language OCR block', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'Уже русская подпись',
        createdAt: '2026-04-03T12:00:00.000Z',
        mediaSnapshot: {
          messageId: 1,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'Уже русская подпись'
        }
      })
    );
    db.saveMediaArtifact({
      fileUniqueId: 'photo-unique',
      chatId: 1,
      telegramMessageId: 1,
      mediaKind: 'photo',
      provider: 'ocr_space',
      providerModel: 'ocr-space',
      artifactKind: 'ocr_text_default',
      artifactStatus: 'success',
      artifactText: 'OPEN DAILY',
      artifactJson: { text: 'OPEN DAILY' },
      rawResponseJson: { text: 'OPEN DAILY' },
      sourceCaption: 'Уже русская подпись',
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 3,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-03T12:00:01.000Z',
      expiresAt: '2026-04-10T12:00:01.000Z'
    });

    const generateReply = vi
      .fn()
      .mockResolvedValue(
        createReplyResult('Текст на картинке:\nОткрыто ежедневно')
      );
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
        messageId: 2,
        text: '/translate',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }],
        replyToMessageId: 1,
        replyToUserId: 42,
        replyToMediaSnapshot: {
          messageId: 1,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 3,
          durationSeconds: null,
          caption: 'Уже русская подпись'
        }
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'translate',
        replyContext: expect.objectContaining({
          replyAnchorMessage: expect.objectContaining({
            text: 'Текст на картинке:\nOPEN DAILY'
          })
        }),
        mediaContext: expect.objectContaining({
          sourceCaption: 'Уже русская подпись',
          ocrTextDefault: 'OPEN DAILY'
        })
      })
    );
  });
});
