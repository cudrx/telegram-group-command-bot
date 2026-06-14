import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createLogger,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator reply anchors', () => {
  test('uses replied-to non-self bot message as answer request anchor', async () => {
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
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 1,
        replyToUserId: 555
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'answer',
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

  test('uses Telegram reply snapshot as answer anchor when the replied-to bot message is not stored', async () => {
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
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
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
    });

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'answer',
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

  test('uses previous message as answer request anchor when no reply exists', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        fromUserId: 42,
        fromDisplayName: 'Tom',
        text: 'кто такой джон голт?',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );

    const generateReply = vi
      .fn()
      .mockResolvedValue(
        createReplyResult('персонаж из Атлант расправил плечи')
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
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'answer',
        replyContext: expect.objectContaining({
          triggerMessage: expect.objectContaining({ messageId: 2 }),
          replyAnchorMessage: expect.objectContaining({
            messageId: 1,
            isBot: false,
            text: 'кто такой джон голт?'
          })
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'персонаж из Атлант расправил плечи'
    });
  });

  test('returns local answer placeholder when no usable reply anchor exists', async () => {
    const db = new FakeDatabaseClient();
    const logger = createLogger();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
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
        text: '/answer кто сильнее лев или тигр',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Сделай reply на сообщение с вопросом и отправь /answer.'
    });
    expect(logger.warn).not.toHaveBeenCalledWith(
      'answer_anchor_missing',
      expect.anything()
    );
  });
});
