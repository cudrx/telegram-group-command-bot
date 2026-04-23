import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createLogger,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator formatting and logging', () => {
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
});
