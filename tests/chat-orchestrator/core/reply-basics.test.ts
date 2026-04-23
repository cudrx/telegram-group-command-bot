import { describe, expect, test, vi } from 'vitest';

import { loadPrompt } from '../../../src/llm/prompt-files.js';
import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator reply basics', () => {
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
});
