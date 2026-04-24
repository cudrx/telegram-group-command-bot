import { describe, expect, test, vi } from 'vitest';

import { FakeDatabaseClient } from '../support/fake-database.js';
import { createLookupPlanResult, createReplyResult } from '../support/llm.js';
import { createIncomingMessage } from '../support/messages.js';
import { createOrchestrator } from '../support/orchestrator.js';

describe('ChatOrchestrator weekly command routing', () => {
  test('runs weekly path for /weekly from private admin', async () => {
    const db = new FakeDatabaseClient();
    const generateWeekly = vi
      .fn()
      .mockResolvedValue(createReplyResult('<b>Неделя в чате</b>'));
    const replyDispatcher = vi.fn();
    const weeklyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn(),
        generateWeekly,
        planLookup: vi.fn().mockResolvedValue(
          createLookupPlanResult({
            shouldLookup: false,
            purpose: 'none',
            reason: 'No lookup needed.',
            queries: [],
            confidence: 'low'
          })
        )
      },
      replyDispatcher,
      weeklyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        chatId: 99,
        chatType: 'private',
        authorizedMode: 'private_admin',
        text: '/weekly',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(generateWeekly).toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
    expect(weeklyDispatcher).toHaveBeenCalled();
  });

  test('ignores /weekly in group chat mode', async () => {
    const db = new FakeDatabaseClient();
    const generateWeekly = vi
      .fn()
      .mockResolvedValue(createReplyResult('<b>Неделя в чате</b>'));
    const replyDispatcher = vi.fn();
    const weeklyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn(),
        generateWeekly
      },
      replyDispatcher,
      weeklyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatType: 'group',
        authorizedMode: 'chat',
        text: '/weekly',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(generateWeekly).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
    expect(weeklyDispatcher).not.toHaveBeenCalled();
  });
});
