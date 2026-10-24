import { describe, expect, test, vi } from 'vitest';

import { createTestChatPolicy } from '../helpers/telegram-fixtures.js';
import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from './support.js';

function setup() {
  const db = new FakeDatabaseClient();
  const generateAnswer = vi.fn().mockResolvedValue({
    ...createReplyResult('Чем помочь?'),
    decision: {
      mode: 'clarify',
      context: { messageIds: [] },
      text: 'Чем помочь?'
    }
  });
  const replyDispatcher = vi.fn().mockResolvedValue({
    messageId: 1000,
    createdAt: '2026-10-24T12:00:00Z'
  });
  const orchestrator = createOrchestrator({
    db,
    qwen: { generateAnswer, generateReply: vi.fn() },
    replyDispatcher
  });

  return { db, generateAnswer, replyDispatcher, orchestrator };
}

describe('assistant mentions', () => {
  test('a bare mention can ask for clarification without a target or another model call', async () => {
    const flow = setup();
    await flow.orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '@fun_bot',
        entities: [{ type: 'mention', offset: 0, length: 8 }]
      })
    );
    expect(flow.generateAnswer).toHaveBeenCalledOnce();
    expect(flow.replyDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Чем помочь?' })
    );
  });

  test('passes the full request and accepts a reply to this bot', async () => {
    const flow = setup();
    flow.db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: null,
      messageId: 1,
      text: 'Мамонты — богатые люди.',
      userId: 77,
      displayName: 'Fun Bot',
      createdAt: '2026-10-24T11:00:00Z'
    });
    await flow.orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '@fun_bot почему богатые?',
        replyToMessageId: 1,
        entities: [{ type: 'mention', offset: 0, length: 8 }]
      })
    );
    expect(flow.generateAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        replyContext: expect.objectContaining({
          triggerMessage: expect.objectContaining({
            text: '@fun_bot почему богатые?'
          }),
          replyAnchorMessage: expect.objectContaining({
            messageId: 1,
            isBot: true
          })
        })
      })
    );
  });

  test.each([
    '/answer',
    '/summarize',
    '/decide'
  ])('ignores removed command %s', async (text) => {
    const flow = setup();
    await flow.orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text,
        entities: [{ type: 'bot_command', offset: 0, length: text.length }]
      })
    );
    expect(flow.generateAnswer).not.toHaveBeenCalled();
    expect(flow.replyDispatcher).not.toHaveBeenCalled();
  });

  test.each([
    {
      text: '@other_bot привет',
      entities: [{ type: 'mention', offset: 0, length: 10 }]
    },
    { text: 'reply без упоминания', replyToUserId: 77 },
    {
      text: '@fun_bot',
      isBot: true,
      entities: [{ type: 'mention', offset: 0, length: 8 }]
    },
    {
      text: '@fun_bot',
      authorizedMode: 'private_link_sender' as const,
      entities: [{ type: 'mention', offset: 0, length: 8 }]
    }
  ])('does not start an unauthorized or implicit assistant flow: $text', async (overrides) => {
    const flow = setup();
    await flow.orchestrator.handleIncomingMessage(
      createIncomingMessage(overrides)
    );
    expect(flow.generateAnswer).not.toHaveBeenCalled();
  });

  test('ignores mentions when assistant is disabled for the chat', async () => {
    const flow = setup();
    await flow.orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '@fun_bot',
        entities: [{ type: 'mention', offset: 0, length: 8 }],
        accessContext: {
          kind: 'configured_chat',
          policy: createTestChatPolicy({
            features: { assistant: false }
          })
        }
      })
    );
    expect(flow.generateAnswer).not.toHaveBeenCalled();
  });

  test('deduplicates concurrent delivery of the same mention', async () => {
    const flow = setup();
    const message = createIncomingMessage({
      text: '@fun_bot',
      entities: [{ type: 'mention', offset: 0, length: 8 }]
    });
    await Promise.all([
      flow.orchestrator.handleIncomingMessage(message),
      flow.orchestrator.handleIncomingMessage(message)
    ]);
    expect(flow.generateAnswer).toHaveBeenCalledOnce();
    expect(
      flow.replyDispatcher.mock.calls.filter(
        ([input]) => input.text === 'Чем помочь?'
      )
    ).toHaveLength(1);
  });
});
