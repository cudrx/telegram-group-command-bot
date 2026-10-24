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
        text: '@fun_bot',
        entities: [{ type: 'mention', offset: 0, length: 8 }],
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
        text: '@fun_bot',
        entities: [{ type: 'mention', offset: 0, length: 8 }],
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

  test('keeps preceding context without replacing the current mention request', async () => {
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
        text: '@fun_bot',
        entities: [{ type: 'mention', offset: 0, length: 8 }]
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'answer',
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
      text: 'персонаж из Атлант расправил плечи'
    });
  });

  test('answers a standalone mention request without requiring a reply anchor', async () => {
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
        text: '@fun_bot кто сильнее лев или тигр',
        entities: [{ type: 'mention', offset: 0, length: 8 }]
      })
    );

    expect(generateReply).toHaveBeenCalledOnce();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'не надо'
    });
    expect(logger.warn).not.toHaveBeenCalledWith(
      'answer_anchor_missing',
      expect.anything()
    );
  });
});
