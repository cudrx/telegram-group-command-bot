import { describe, expect, test, vi } from 'vitest';

import { loadPrompt } from '../../src/llm/prompt-files.js';
import type { NormalizedMessage } from '../../src/domain/models.js';
import {
  createIncomingMessage,
  createLogger,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from './support.js';

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
});
