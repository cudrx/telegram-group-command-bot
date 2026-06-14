import { describe, expect, test, vi } from 'vitest';

import type { ChatPolicy } from '../../src/config/env/types.js';
import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from './support.js';

function createPolicy(
  featureOverrides: Partial<ChatPolicy['features']> = {}
): ChatPolicy {
  return {
    chatId: 1,
    label: 'friends',
    features: {
      answer: true,
      summarize: true,
      decide: true,
      translate: true,
      read: true,
      transcribe: true,
      meme: true,
      sex: true,
      direct_links: true,
      ...featureOverrides
    }
  };
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
          policy: createPolicy({ answer: false })
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
          policy: createPolicy({ meme: false })
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
          policy: createPolicy({ direct_links: false })
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
          policy: createPolicy({ answer: true })
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

  test('keeps /publish available for private admin flow independent of chat features', async () => {
    const db = new FakeDatabaseClient();
    const copyMessageDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001
    });
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      copyMessageDispatcher,
      env: { telegramAdminDefaultChatId: -1001 }
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

    expect(copyMessageDispatcher).toHaveBeenCalledWith({
      targetChatId: -1001,
      sourceChatId: 900000222,
      messageId: 1
    });
    expect(replyDispatcher).not.toHaveBeenCalled();
  });
});
