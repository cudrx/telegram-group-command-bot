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

describe('assistant invocations', () => {
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

  test.each([
    '@fun_bot почему богатые?',
    'почему богатые?'
  ])('continues a reply to this bot and preserves its parent request: %s', async (requestText) => {
    const flow = setup();
    flow.db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'Здесь мамонт — тот, кого обманывают мошенники.'
      })
    );
    flow.db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: null,
      messageId: 2,
      replyToMessageId: 1,
      text: 'Мамонты — богатые люди.',
      userId: 77,
      displayName: 'Fun Bot',
      createdAt: '2026-10-24T11:00:00Z'
    });
    await flow.orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 3,
        text: requestText,
        replyToMessageId: 2,
        replyToUserId: 77,
        entities: requestText.startsWith('@')
          ? [{ type: 'mention', offset: 0, length: 8 }]
          : []
      })
    );
    expect(flow.generateAnswer).toHaveBeenCalledOnce();
    expect(flow.generateAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        replyContext: expect.objectContaining({
          triggerMessage: expect.objectContaining({
            text: requestText
          }),
          priorContextMessages: expect.arrayContaining([
            expect.objectContaining({ messageId: 1 })
          ]),
          replyAnchorMessage: expect.objectContaining({
            messageId: 2,
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
        replyToMessageId: 1,
        replyToUserId: 77,
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
    { text: 'reply человеку', replyToMessageId: 1, replyToUserId: 42 },
    { text: 'reply другому боту', replyToMessageId: 1, replyToUserId: 88 },
    {
      text: 'reply от бота',
      replyToMessageId: 1,
      replyToUserId: 77,
      isBot: true
    },
    {
      text: 'reply от link-only пользователя',
      replyToMessageId: 1,
      replyToUserId: 77,
      authorizedMode: 'private_link_sender' as const
    },
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

  test.each([
    'mention',
    'reply'
  ])('ignores %s when assistant is disabled for the chat', async (trigger) => {
    const flow = setup();
    await flow.orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: trigger === 'mention' ? '@fun_bot' : 'поясни',
        entities:
          trigger === 'mention'
            ? [{ type: 'mention', offset: 0, length: 8 }]
            : [],
        replyToMessageId: trigger === 'reply' ? 1 : null,
        replyToUserId: trigger === 'reply' ? 77 : null,
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
