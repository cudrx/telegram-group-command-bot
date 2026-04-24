import { describe, expect, test, vi } from 'vitest';

import { FakeDatabaseClient } from '../support/fake-database.js';
import { createReplyResult } from '../support/llm.js';
import { createIncomingMessage } from '../support/messages.js';
import { createOrchestrator } from '../support/orchestrator.js';

function seedGroupWeek(
  db: FakeDatabaseClient,
  overrides: {
    chatType?: 'group' | 'supergroup';
    chatTitle?: string | null;
  } = {}
): void {
  for (let index = 0; index < 12; index += 1) {
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatType: overrides.chatType ?? 'group',
        chatTitle: overrides.chatTitle ?? 'Weekly Group',
        messageId: index + 1,
        fromUserId: index % 2 === 0 ? 42 : 43,
        fromDisplayName: index % 2 === 0 ? 'Том' : 'Аня',
        text: `важное сообщение ${index + 1}`,
        createdAt: `2026-04-12T09:${String(index).padStart(2, '0')}:00.000Z`,
        replyToMessageId: index > 2 ? 1 : null
      })
    );
  }
}

describe('ChatOrchestrator weekly orchestration', () => {
  test('generates weekly report, sends it to group, and saves bot message there', async () => {
    const db = new FakeDatabaseClient();
    seedGroupWeek(db);
    const generateWeekly = vi
      .fn()
      .mockResolvedValue(createReplyResult('<b>Неделя в чате</b>\n• живо'));
    const replyDispatcher = vi.fn();
    const weeklyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      env: { telegramChatId: 1 },
      qwen: {
        generateReply: vi.fn(),
        generateWeekly
      },
      replyDispatcher,
      weeklyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        chatId: 99,
        chatType: 'private',
        authorizedMode: 'private_admin',
        messageId: 99,
        text: '/weekly',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(generateWeekly).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantInstructions: expect.any(String),
        weeklyDataset: expect.stringContaining('SELECTED_EVENTS')
      })
    );
    expect(replyDispatcher).not.toHaveBeenCalled();
    expect(weeklyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      text: '<b>Неделя в чате</b>\n• живо'
    });
    expect(db.getMessageByTelegramMessageId(1, 1001)).toEqual(
      expect.objectContaining({
        chatId: 1,
        messageId: 1001,
        isBot: true,
        text: '<b>Неделя в чате</b>\n• живо'
      })
    );
  });

  test('preserves target chat metadata when saving weekly bot message', async () => {
    const db = new FakeDatabaseClient();
    seedGroupWeek(db, {
      chatType: 'supergroup',
      chatTitle: 'Important Weekly Chat'
    });
    const generateWeekly = vi
      .fn()
      .mockResolvedValue(createReplyResult('<b>Неделя в чате</b>'));
    const orchestrator = createOrchestrator({
      db,
      env: { telegramChatId: 1 },
      qwen: {
        generateReply: vi.fn(),
        generateWeekly
      },
      replyDispatcher: vi.fn(),
      weeklyDispatcher: vi.fn().mockResolvedValue({
        messageId: 1002,
        createdAt: '2026-04-13T09:00:30.000Z'
      })
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        chatId: 99,
        chatType: 'private',
        authorizedMode: 'private_admin',
        messageId: 99,
        text: '/weekly',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(db.getChatState(1)).toEqual(
      expect.objectContaining({
        chatType: 'supergroup',
        title: 'Important Weekly Chat'
      })
    );
  });
});
