import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createOrchestrator,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator publish command', () => {
  test('copies replied-to private message into the configured chat', async () => {
    const db = new FakeDatabaseClient();
    const copyMessageDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const copyMessagesDispatcher = vi.fn().mockResolvedValue([]);
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1002,
      createdAt: '2026-04-03T12:00:31.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      copyMessageDispatcher,
      copyMessagesDispatcher,
      env: { telegramChatId: -1001 }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        chatId: 84626969,
        chatType: 'private',
        authorizedMode: 'private_admin',
        messageId: 2,
        text: '/publish',
        entities: [{ type: 'bot_command', offset: 0, length: 8 }],
        replyToMessageId: 1,
        replyToMessageSnapshot: {
          chatId: 84626969,
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
      sourceChatId: 84626969,
      messageId: 1
    });
    expect(copyMessagesDispatcher).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test('copies previous private message when command has no reply', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 84626969,
        chatType: 'private',
        authorizedMode: 'private_admin',
        messageId: 1,
        text: 'сообщение перед командой'
      })
    );

    const copyMessageDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher: vi.fn(),
      copyMessageDispatcher,
      env: { telegramChatId: -1001 }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        chatId: 84626969,
        chatType: 'private',
        authorizedMode: 'private_admin',
        messageId: 2,
        text: '/publish',
        entities: [{ type: 'bot_command', offset: 0, length: 8 }]
      })
    );

    expect(copyMessageDispatcher).toHaveBeenCalledWith({
      targetChatId: -1001,
      sourceChatId: 84626969,
      messageId: 1
    });
  });

  test('copies complete album from stored media group messages', async () => {
    const db = new FakeDatabaseClient();
    for (const messageId of [10, 11, 12]) {
      db.saveIncomingMessage(
        createIncomingMessage({
          chatId: 84626969,
          chatType: 'private',
          authorizedMode: 'private_admin',
          messageId,
          mediaGroupId: 'album-1',
          text: messageId === 10 ? 'подпись' : ''
        })
      );
    }

    const copyMessageDispatcher = vi.fn();
    const copyMessagesDispatcher = vi.fn().mockResolvedValue([
      { messageId: 1001, createdAt: '2026-04-03T12:00:30.000Z' },
      { messageId: 1002, createdAt: '2026-04-03T12:00:30.000Z' },
      { messageId: 1003, createdAt: '2026-04-03T12:00:30.000Z' }
    ]);
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher: vi.fn(),
      copyMessageDispatcher,
      copyMessagesDispatcher,
      env: { telegramChatId: -1001 }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        chatId: 84626969,
        chatType: 'private',
        authorizedMode: 'private_admin',
        messageId: 20,
        text: '/publish',
        entities: [{ type: 'bot_command', offset: 0, length: 8 }],
        replyToMessageId: 11,
        replyToMessageSnapshot: {
          chatId: 84626969,
          messageId: 11,
          mediaGroupId: 'album-1',
          userId: 42,
          senderDisplayName: 'Tom',
          text: '',
          createdAt: '2026-04-03T12:00:01.000Z',
          isBot: false,
          replyToMessageId: null
        }
      })
    );

    expect(copyMessagesDispatcher).toHaveBeenCalledWith({
      targetChatId: -1001,
      sourceChatId: 84626969,
      messageIds: [10, 11, 12]
    });
    expect(copyMessageDispatcher).not.toHaveBeenCalled();
  });

  test('replies with a local hint when no target message exists', async () => {
    const db = new FakeDatabaseClient();
    const copyMessageDispatcher = vi.fn();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      copyMessageDispatcher,
      env: { telegramChatId: -1001 }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        chatId: 84626969,
        chatType: 'private',
        authorizedMode: 'private_admin',
        messageId: 2,
        text: '/publish',
        entities: [{ type: 'bot_command', offset: 0, length: 8 }]
      })
    );

    expect(copyMessageDispatcher).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 84626969,
      replyToMessageId: 2,
      text: 'Не нашел сообщение для /publish. Сделай reply или отправь команду после сообщения.'
    });
  });
});
