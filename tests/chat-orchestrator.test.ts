import { describe, expect, test, vi } from 'vitest';

import { ChatOrchestrator } from '../src/app/chat-orchestrator.js';
import type { AppEnv } from '../src/config/env.js';
import type {
  ChatState,
  NormalizedMessage,
  StoredMessage
} from '../src/domain/models.js';
import { loadPrompt } from '../src/llm/prompt-files.js';
import type { AppLogger } from '../src/logging/logger.js';
import type { LookupProvider } from '../src/lookup/types.js';
import type {
  SaveMediaArtifactInput,
  StoredMediaArtifact
} from '../src/storage/database.js';

describe('ChatOrchestrator', () => {
  test('ignores ordinary messages and does not call the LLM', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({ text: 'обычно болтаем' })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('ignores ordinary mentions and does not call the LLM', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '@fun_bot кто прав?',
        entities: [{ type: 'mention', offset: 0, length: 8 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('replies to command modes with assistant instructions and recent chat context', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'до этого был вопрос',
        createdAt: '2026-04-03T12:00:00.000Z'
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
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/decide',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantInstructions: loadPrompt('base'),
        targetDisplayName: 'Tom',
        intent: 'decide',
        lookupContext: null,
        mediaContext: null,
        replyContext: expect.objectContaining({
          triggerMessage: expect.objectContaining({ messageId: 2 }),
          replyAnchorMessage: null,
          priorContextMessages: [expect.objectContaining({ messageId: 1 })]
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'держи'
    });
    expect(db.getMessageByTelegramMessageId(1, 1001)).toMatchObject({
      messageId: 1001,
      text: 'держи',
      replyToMessageId: 2,
      isBot: true
    });
  });

  test('returns local read disabled placeholder when media analysis is off', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
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
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Распознавание медиа сейчас выключено.'
    });
  });

  test('returns read usage when command is not a reply to media', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
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
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Сделай reply на голосовое, кружочек или картинку и отправь /read.'
    });
  });

  test('recognizes replied voice media, caches artifact, and sends media context to LLM', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'контекст перед войсом',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('привет из войса'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const transcribe = vi.fn().mockResolvedValue({
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifact: {
        type: 'transcript',
        transcript: 'привет из войса',
        language: 'ru',
        duration: 3
      },
      rawResponse: { status: 'done' },
      sourceDurationSeconds: 3
    });
    const cleanupFetch = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'voice/file.ogg' })
      },
      fetch: cleanupFetch as typeof fetch,
      speechToTextProvider: { transcribe }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
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

    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'voice-90.ogg',
        mimeType: 'audio/ogg'
      })
    );
    expect(db.savedMediaArtifacts).toHaveLength(1);
    expect(db.savedMediaArtifacts[0]).toMatchObject({
      fileUniqueId: 'voice-unique',
      provider: 'gladia',
      artifactKind: 'transcript',
      artifactText: 'привет из войса'
    });
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'read',
        mediaContext: {
          sourceCaption: null,
          visionRaw: null,
          visionInterpretation: null,
          audioTranscript: {
            transcript: 'привет из войса',
            language: 'ru',
            sourceDurationSeconds: 3
          }
        }
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'привет из войса'
    });
  });

  test('reads replied image through vision raw plus interpretation cache layers', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('Интерпретация картинки'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const describe = vi.fn().mockResolvedValue({
      provider: 'cloudflare',
      providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
      rawText: 'Raw image description',
      rawResponse: { response: 'Raw image description' }
    });
    const cleanupFetch = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: cleanupFetch as typeof fetch,
      visionProvider: { describe }
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

    expect(describe).toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'read',
        mediaContext: {
          sourceCaption: 'подпись к фото',
          visionRaw: 'Raw image description',
          visionInterpretation: null,
          audioTranscript: null
        }
      })
    );
    expect(db.savedMediaArtifacts).toHaveLength(2);
    expect(db.savedMediaArtifacts[0]).toMatchObject({
      provider: 'cloudflare',
      artifactKind: 'vision_raw',
      artifactText: 'Raw image description'
    });
    expect(db.savedMediaArtifacts[1]).toMatchObject({
      provider: 'deepseek',
      artifactKind: 'vision_interpretation',
      artifactText: 'Интерпретация картинки'
    });
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Интерпретация картинки'
    });
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
      artifactKind: 'vision_raw',
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
          visionRaw: 'Raw image description',
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
        intent: 'answer',
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

  test('formats replies before dispatching and saving bot messages', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(
        createReplyResult('<b>Коротко</b>\n\n- пункт\n<script>alert</script>')
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
        text: '/summarize',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }]
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: '<b>Коротко</b>\n\n• пункт\nalert'
    });
    expect(db.getMessageByTelegramMessageId(1, 1001)).toMatchObject({
      messageId: 1001,
      text: '<b>Коротко</b>\n\n• пункт\nalert',
      replyToMessageId: 2,
      isBot: true
    });
  });

  test('logs completed reply jobs at debug level only', async () => {
    const db = new FakeDatabaseClient();
    const logger = createLogger();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult('держи'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      logger
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/summarize',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }]
      })
    );

    expect(logger.info).not.toHaveBeenCalledWith(
      'reply_job_completed',
      expect.any(Object)
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'reply_job_completed',
      expect.objectContaining({
        intent: 'summarize',
        llmModel: 'reply-model'
      })
    );
  });

  test('uses replied-to non-self bot message as explain request anchor', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        fromUserId: 555,
        fromDisplayName: 'Rofl Bot',
        isBot: true,
        text: 'кто сильнее лев или тигр?',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );

    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('тигр вероятнее'));
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
        text: '/explain',
        entities: [{ type: 'bot_command', offset: 0, length: 8 }],
        replyToMessageId: 1,
        replyToUserId: 555
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'explain',
        replyContext: expect.objectContaining({
          triggerMessage: expect.objectContaining({ messageId: 2 }),
          replyAnchorMessage: expect.objectContaining({
            messageId: 1,
            isBot: true,
            text: 'кто сильнее лев или тигр?'
          })
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'тигр вероятнее'
    });
  });

  test('uses Telegram reply snapshot as explain anchor when the replied-to bot message is not stored', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('это ответ другого бота'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage({
      ...createIncomingMessage({
        messageId: 2,
        text: '/explain',
        entities: [{ type: 'bot_command', offset: 0, length: 8 }],
        replyToMessageId: 1,
        replyToUserId: 555
      }),
      replyToMessageSnapshot: {
        chatId: 1,
        messageId: 1,
        userId: 555,
        senderDisplayName: 'Rofl Bot (@rofl_bot)',
        text: 'кто сильнее лев или тигр?',
        createdAt: '2026-04-03T12:00:00.000Z',
        isBot: true,
        replyToMessageId: null
      }
    } as NormalizedMessage);

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'explain',
        replyContext: expect.objectContaining({
          replyAnchorMessage: expect.objectContaining({
            messageId: 1,
            userId: 555,
            isBot: true,
            text: 'кто сильнее лев или тигр?'
          })
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'это ответ другого бота'
    });
  });

  test('returns local explain placeholder when no usable reply anchor exists', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
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
        text: '/explain кто сильнее лев или тигр',
        entities: [{ type: 'bot_command', offset: 0, length: 8 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Сделай reply на сообщение с вопросом и отправь /explain.'
    });
  });

  test('does not plan lookup for summarize', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('коротко'));
    const planLookup = vi.fn().mockResolvedValue(
      createLookupPlanResult({
        shouldLookup: true,
        purpose: 'entity_grounding',
        reason: 'Should not be called for summarize.',
        queries: ['ignored'],
        confidence: 'high'
      })
    );
    const lookupProvider = {
      search: vi.fn().mockResolvedValue({
        provider: 'tavily',
        query: 'ignored',
        sources: [],
        responseTimeMs: 1,
        usageCredits: 1
      })
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/summarize',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }]
      })
    );

    expect(planLookup).not.toHaveBeenCalled();
    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'summarize',
        lookupContext: null
      })
    );
  });

  test('does not plan lookup when lookup is disabled', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('вердикт'));
    const planLookup = vi.fn();
    const lookupProvider = {
      search: vi.fn()
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: false }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/decide',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(planLookup).not.toHaveBeenCalled();
    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'decide',
        lookupContext: null
      })
    );
  });

  test('plans and uses Tavily lookup for decide when planner requests it', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'кто лучше дора или мейби бэйби?',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );

    const decision = {
      shouldLookup: true,
      purpose: 'entity_grounding' as const,
      reason: 'Need to identify the artists.',
      queries: ['Дора Мэйби Бэйби певицы кто такие'],
      confidence: 'high' as const
    };
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('вердикт'));
    const planLookup = vi
      .fn()
      .mockResolvedValue(createLookupPlanResult(decision));
    const lookupProvider = {
      search: vi.fn().mockResolvedValue({
        provider: 'tavily',
        query: 'Дора Мэйби Бэйби певицы кто такие',
        sources: [
          {
            title: 'Дора (певица)',
            url: 'https://example.com/dora',
            content: 'Дора - российская певица.',
            score: 0.91
          }
        ],
        responseTimeMs: 321,
        usageCredits: 1
      })
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: {
        lookupEnabled: true,
        lookupMaxResults: 3,
        lookupTimeoutMs: 7000
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/decide',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(planLookup).toHaveBeenCalledWith({
      intent: 'decide',
      replyContext: expect.objectContaining({
        priorContextMessages: [expect.objectContaining({ messageId: 1 })]
      })
    });
    expect(lookupProvider.search).toHaveBeenCalledWith({
      query: 'Дора Мэйби Бэйби певицы кто такие',
      maxResults: 3,
      timeoutMs: 7000
    });
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'decide',
        lookupContext: expect.objectContaining({
          status: 'used',
          provider: 'tavily',
          query: 'Дора Мэйби Бэйби певицы кто такие',
          sources: [
            expect.objectContaining({
              title: 'Дора (певица)',
              url: 'https://example.com/dora'
            })
          ]
        })
      })
    );
  });

  test('passes failed lookup context to final reply when Tavily fails', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'кто лучше дора или мейби бэйби?',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );

    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('вердикт'));
    const planLookup = vi.fn().mockResolvedValue(
      createLookupPlanResult({
        shouldLookup: true,
        purpose: 'entity_grounding',
        reason: 'Need to identify the artists.',
        queries: ['Дора Мэйби Бэйби певицы кто такие'],
        confidence: 'high'
      })
    );
    const lookupProvider = {
      search: vi.fn().mockRejectedValue(new Error('network down'))
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/decide',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupContext: expect.objectContaining({
          status: 'failed',
          errorMessage: 'network down'
        })
      })
    );
  });

  test('continues with failed lookup context when planner fails', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('вердикт без поиска'));
    const planLookup = vi.fn().mockRejectedValue(new Error('planner quota'));
    const lookupProvider = {
      search: vi.fn()
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/decide',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupContext: expect.objectContaining({
          status: 'failed',
          provider: null,
          query: null,
          errorMessage: 'planner quota'
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'вердикт без поиска'
    });
  });

  test('continues with failed lookup context when planner output is malformed', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('вердикт без поиска'));
    const planLookup = vi.fn().mockResolvedValue({
      status: 'failed',
      decision: {
        shouldLookup: false,
        purpose: 'none',
        reason: 'Lookup planner returned invalid JSON.',
        queries: [],
        confidence: 'low'
      },
      model: 'planner-model',
      latencyMs: 5,
      attemptCount: 1,
      promptTokensEstimate: 30
    });
    const lookupProvider = {
      search: vi.fn()
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/decide',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupContext: expect.objectContaining({
          status: 'failed',
          provider: null,
          query: null,
          errorMessage: 'Lookup planner returned invalid JSON.'
        })
      })
    );
  });
});

function createOrchestrator(input: {
  db: FakeDatabaseClient;
  qwen: {
    generateReply: (input: {
      assistantInstructions: string;
      targetDisplayName: string;
      intent: 'explain' | 'summarize' | 'decide' | 'read' | 'answer';
      replyContext: unknown;
      lookupContext?: unknown;
      mediaContext?: unknown;
    }) => Promise<ReturnType<typeof createReplyResult>>;
    planLookup?: (input: {
      intent: 'explain' | 'decide' | 'answer';
      replyContext: unknown;
    }) => Promise<ReturnType<typeof createLookupPlanResult>>;
  };
  replyDispatcher: (input: {
    chatId: number;
    replyToMessageId: number;
    text: string;
  }) => Promise<{ messageId: number; createdAt: string }>;
  lookupProvider?: LookupProvider | null;
  speechToTextProvider?: {
    transcribe: (input: {
      filePath: string;
      filename: string;
      mimeType: string;
      timeoutMs: number;
    }) => Promise<unknown>;
  } | null;
  visionProvider?: {
    describe: (input: {
      filePath: string;
      timeoutMs: number;
    }) => Promise<unknown>;
  } | null;
  telegramFileApi?: {
    getFile: (fileId: string) => Promise<{ file_path?: string | null }>;
  } | null;
  fetch?: typeof fetch | undefined;
  env?: Partial<AppEnv>;
  logger?: AppLogger;
}): ChatOrchestrator {
  return new ChatOrchestrator({
    db: input.db as never,
    qwen: {
      ...input.qwen,
      planLookup:
        input.qwen.planLookup ??
        vi.fn().mockResolvedValue(
          createLookupPlanResult({
            shouldLookup: false,
            purpose: 'none',
            reason: 'No lookup needed.',
            queries: [],
            confidence: 'low'
          })
        )
    },
    lookupProvider: input.lookupProvider ?? null,
    speechToTextProvider: input.speechToTextProvider as never,
    visionProvider: input.visionProvider as never,
    telegramFileApi: input.telegramFileApi ?? null,
    fetch: input.fetch,
    env: createEnv(input.env),
    bot: {
      userId: 77,
      username: 'fun_bot',
      displayName: 'Fun Bot'
    },
    replyDispatcher: input.replyDispatcher,
    sendTyping: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
    logger: input.logger ?? createLogger(),
    random: () => 0,
    now: () => '2026-04-13T09:00:10.000Z'
  });
}

function createEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    nodeEnv: 'test',
    telegramBotToken: 'telegram-token',
    llmApiKey: 'llm-key',
    llmBaseUrl: 'https://example.com',
    llmReplyModel: 'reply-model',
    llmReplyTemperature: 0.6,
    llmReplyEnableThinking: false,
    llmTimeoutMs: 20_000,
    llmMaxRetries: 1,
    logLlmText: false,
    logLevel: 'info',
    logColor: true,
    sqlitePath: ':memory:',
    explainContextLimit: 50,
    answerContextLimit: 50,
    summarizeContextLimit: 200,
    decideContextLimit: 100,
    replyMinTypingMs: 0,
    replyMaxTypingMs: 0,
    replyTypingRefreshMs: 4000,
    llmPlannerModel: 'planner-model',
    lookupEnabled: false,
    lookupProvider: 'tavily',
    tavilyApiKey: null,
    lookupTimeoutMs: 7000,
    lookupMaxQueries: 1,
    lookupMaxResults: 3,
    mediaAnalysisEnabled: false,
    readContextLimit: 10,
    sttProvider: 'gladia',
    gladiaApiKey: null,
    visionProvider: 'cloudflare',
    cloudflareAiApiKey: null,
    cloudflareAccountId: null,
    mediaMaxFileBytes: 10_000_000,
    mediaArtifactRetentionDays: 7,
    messageRetentionDays: 7,
    databaseCleanupIntervalHours: 24,
    deployNotifyChatId: -1002155313986,
    ...overrides
  };
}

function createIncomingMessage(
  overrides: Partial<NormalizedMessage> = {}
): NormalizedMessage {
  return {
    chatId: 1,
    chatType: 'group',
    chatTitle: 'Friends',
    messageId: 1,
    text: 'обычное сообщение',
    createdAt: '2026-04-03T12:00:00.000Z',
    fromUserId: 42,
    fromUsername: 'tom',
    fromFirstName: 'Tom',
    fromLastName: null,
    fromDisplayName: 'Tom',
    isBot: false,
    entities: [],
    replyToUserId: null,
    replyToMessageId: null,
    replyToMessageSnapshot: null,
    replyToMediaSnapshot: null,
    mediaSnapshot: null,
    ...overrides
  };
}

function createReplyResult(text: string) {
  return {
    text,
    model: 'reply-model',
    latencyMs: 10,
    attemptCount: 1,
    promptTokensEstimate: 20
  };
}

function createLookupPlanResult(decision: {
  shouldLookup: boolean;
  purpose:
    | 'none'
    | 'entity_grounding'
    | 'fact_check'
    | 'freshness'
    | 'link_extraction';
  reason: string;
  queries: string[];
  confidence: 'high' | 'medium' | 'low';
}) {
  return {
    status: 'ok' as const,
    decision,
    model: 'planner-model',
    latencyMs: 5,
    attemptCount: 1,
    promptTokensEstimate: 30
  };
}

function createLogger(): AppLogger {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn()
  };

  logger.child.mockReturnValue(logger);

  return {
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
    child: logger.child
  };
}

function toStoredMediaArtifact(
  input: SaveMediaArtifactInput
): StoredMediaArtifact {
  return {
    id: 1,
    ...input
  };
}

function findLastMediaArtifact(
  artifacts: SaveMediaArtifactInput[],
  predicate: (artifact: SaveMediaArtifactInput) => boolean
): SaveMediaArtifactInput | null {
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = artifacts[index];

    if (artifact && predicate(artifact)) {
      return artifact;
    }
  }

  return null;
}

class FakeDatabaseClient {
  private readonly messages = new Map<number, StoredMessage[]>();
  private readonly chats = new Map<number, ChatState>();
  readonly savedMediaArtifacts: SaveMediaArtifactInput[] = [];

  saveIncomingMessage(message: NormalizedMessage): boolean {
    const chat = this.getOrCreateChat(message);

    chat.lastMessageAt = message.createdAt;
    this.chats.set(message.chatId, chat);

    return this.insertMessage({
      chatId: message.chatId,
      messageId: message.messageId,
      userId: message.fromUserId,
      senderDisplayName: message.fromDisplayName,
      text: message.text,
      createdAt: message.createdAt,
      isBot: message.isBot,
      replyToMessageId: message.replyToMessageId,
      mediaSnapshot: message.mediaSnapshot
    });
  }

  saveBotMessage(input: {
    chatId: number;
    chatType: string;
    chatTitle: string | null;
    messageId: number;
    text: string;
    createdAt: string;
    userId: number;
    username?: string | null;
    displayName: string;
    replyToMessageId?: number | null;
  }): void {
    const chat = this.getOrCreateChat({
      chatId: input.chatId,
      chatType: input.chatType as NormalizedMessage['chatType'],
      chatTitle: input.chatTitle,
      createdAt: input.createdAt
    });

    chat.lastMessageAt = input.createdAt;
    chat.lastBotMessageAt = input.createdAt;
    this.chats.set(input.chatId, chat);
    this.insertMessage({
      chatId: input.chatId,
      messageId: input.messageId,
      userId: input.userId,
      senderDisplayName: input.displayName,
      text: input.text,
      createdAt: input.createdAt,
      isBot: true,
      replyToMessageId: input.replyToMessageId ?? null,
      mediaSnapshot: null
    });
  }

  getChatState(chatId: number): ChatState | null {
    const chat = this.chats.get(chatId);

    return chat ? { ...chat } : null;
  }

  getMessagesBefore(
    chatId: number,
    beforeMessageId: number,
    limit: number
  ): StoredMessage[] {
    return (this.messages.get(chatId) ?? [])
      .filter((message) => message.messageId < beforeMessageId)
      .slice(-limit)
      .map((message) => ({ ...message }));
  }

  getMessageByTelegramMessageId(
    chatId: number,
    messageId: number
  ): StoredMessage | null {
    const message = (this.messages.get(chatId) ?? []).find(
      (candidate) => candidate.messageId === messageId
    );

    return message ? { ...message } : null;
  }

  saveMediaArtifact(input: SaveMediaArtifactInput): void {
    this.savedMediaArtifacts.push(input);
  }

  getSuccessfulMediaArtifact(input: {
    fileUniqueId: string | null;
    chatId: number;
    telegramMessageId: number;
    provider: string;
    artifactKind: string;
  }): StoredMediaArtifact | null {
    const byFileUniqueId = input.fileUniqueId
      ? findLastMediaArtifact(this.savedMediaArtifacts, (artifact) => {
          return (
            artifact.fileUniqueId === input.fileUniqueId &&
            artifact.provider === input.provider &&
            artifact.artifactKind === input.artifactKind &&
            artifact.artifactStatus === 'success'
          );
        })
      : null;
    const artifact =
      byFileUniqueId ??
      findLastMediaArtifact(this.savedMediaArtifacts, (candidate) => {
        return (
          candidate.chatId === input.chatId &&
          candidate.telegramMessageId === input.telegramMessageId &&
          candidate.provider === input.provider &&
          candidate.artifactKind === input.artifactKind &&
          candidate.artifactStatus === 'success'
        );
      });

    return artifact ? toStoredMediaArtifact(artifact) : null;
  }

  getSuccessfulMediaArtifactsForMessages(input: {
    chatId: number;
    messageIds: number[];
  }): StoredMediaArtifact[] {
    return this.savedMediaArtifacts
      .filter((artifact) => {
        return (
          artifact.chatId === input.chatId &&
          input.messageIds.includes(artifact.telegramMessageId) &&
          artifact.artifactStatus === 'success'
        );
      })
      .map((artifact) => toStoredMediaArtifact(artifact));
  }

  private insertMessage(message: StoredMessage): boolean {
    const messages = this.messages.get(message.chatId) ?? [];

    if (messages.some((existing) => existing.messageId === message.messageId)) {
      return false;
    }

    messages.push({ ...message });
    messages.sort((left, right) => left.messageId - right.messageId);
    this.messages.set(message.chatId, messages);

    return true;
  }

  private getOrCreateChat(input: {
    chatId: number;
    chatType: NormalizedMessage['chatType'];
    chatTitle: string | null;
    createdAt: string;
  }): ChatState {
    return (
      this.chats.get(input.chatId) ?? {
        chatId: input.chatId,
        chatType: input.chatType,
        title: input.chatTitle,
        lastMessageAt: input.createdAt,
        lastBotMessageAt: null
      }
    );
  }
}
