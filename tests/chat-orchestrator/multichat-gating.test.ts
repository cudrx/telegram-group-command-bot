import { describe, expect, test, vi } from 'vitest';

import type { ChatPolicy } from '../../src/config/env/types.js';
import { createTestChatPolicy } from '../helpers/telegram-fixtures.js';
import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from './support.js';

function createPolicy(
  overrides: {
    commands?: Partial<ChatPolicy['commands']>;
    features?: Partial<ChatPolicy['features']>;
  } = {}
): ChatPolicy {
  return createTestChatPolicy({
    chatId: 1,
    label: 'friends',
    ...(overrides.commands ? { commands: overrides.commands } : {}),
    ...(overrides.features ? { features: overrides.features } : {})
  });
}

describe('ChatOrchestrator multichat gating', () => {
  test('silently ignores /answer when the chat disables answer', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn();
    const replyDispatcher = vi.fn();
    const sendChatAction = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      sendChatAction
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/answer кто прав?',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        accessContext: {
          kind: 'configured_chat',
          policy: createPolicy({ commands: { answer: false } })
        }
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();
  });

  test('silently ignores /meme when the chat disables meme', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn();
    const replyDispatcher = vi.fn();
    const fetchMock = vi.fn();
    const memeDispatcher = vi.fn();
    const sendChatAction = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      fetch: fetchMock,
      memeDispatcher,
      sendChatAction
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: '/meme',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        accessContext: {
          kind: 'configured_chat',
          policy: createPolicy({ commands: { meme: false } })
        }
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(memeDispatcher).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();
  });

  test('silently ignores direct media links when the chat disables direct links', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn();
    const replyDispatcher = vi.fn();
    const fetchMock = vi.fn();
    const memeDispatcher = vi.fn();
    const sendChatAction = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      fetch: fetchMock,
      memeDispatcher,
      sendChatAction
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: 'https://www.reddit.com/r/SipsTea/comments/1ti5fvt/title/',
        accessContext: {
          kind: 'configured_chat',
          policy: createPolicy({ features: { direct_links: false } })
        }
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(memeDispatcher).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();
  });

  test('executes an existing command when the feature is enabled for the chat', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        fromUserId: 555,
        fromDisplayName: 'Rofl Bot',
        isBot: true,
        text: 'кто прав?',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('готово'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 101,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const sendChatAction = vi.fn().mockResolvedValue(undefined);
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      sendChatAction
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 1,
        replyToUserId: 555,
        accessContext: {
          kind: 'configured_chat',
          policy: createPolicy({ commands: { answer: true } })
        }
      })
    );

    expect(generateReply).toHaveBeenCalledOnce();
    expect(replyDispatcher).toHaveBeenLastCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'готово'
    });
    expect(sendChatAction).toHaveBeenCalled();
  });

  test('ignores removed /publish in private admin flow', async () => {
    const db = new FakeDatabaseClient();
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      env: {}
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        chatId: 900000222,
        chatType: 'private',
        messageId: 2,
        text: '/publish',
        entities: [{ type: 'bot_command', offset: 0, length: 8 }],
        accessContext: { kind: 'private_admin' },
        replyToMessageId: 1,
        replyToMessageSnapshot: {
          chatId: 900000222,
          messageId: 1,
          userId: 42,
          senderDisplayName: 'Tom',
          text: 'важное сообщение',
          createdAt: '2026-04-03T12:00:00.000Z',
          isBot: false,
          replyToMessageId: null
        }
      })
    );

    expect(replyDispatcher).not.toHaveBeenCalled();
  });
});
