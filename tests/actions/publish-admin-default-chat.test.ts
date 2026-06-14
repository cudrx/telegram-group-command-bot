import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createOrchestrator,
  FakeDatabaseClient
} from '../chat-orchestrator/support.js';

describe('/publish admin default chat routing', () => {
  test('copies into telegramAdminDefaultChatId when configured', async () => {
    const copyMessageDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001
    });
    const orchestrator = createOrchestrator({
      db: new FakeDatabaseClient(),
      qwen: { generateReply: vi.fn() },
      replyDispatcher: vi.fn(),
      copyMessageDispatcher,
      env: {
        telegramAdminDefaultChatId: -1001
      }
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
  });

  test('replies locally when operator default chat is not configured', async () => {
    const copyMessageDispatcher = vi.fn();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1002,
      createdAt: '2026-04-03T12:00:31.000Z'
    });
    const orchestrator = createOrchestrator({
      db: new FakeDatabaseClient(),
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      copyMessageDispatcher,
      env: {
        telegramAdminDefaultChatId: null
      }
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

    expect(copyMessageDispatcher).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 900000222,
      replyToMessageId: 2,
      text: 'Для /publish не настроен чат назначения. Добавь adminDefaultChatId в telegram-access-config.json.'
    });
  });
});
