import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createLookupPlanResult,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator lookup failure paths', () => {
  test('passes failed lookup context to final reply when Tavily fails', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'кто лучше дора или мейби бэйби?',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );

    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('вердикт'));
    const planLookup = vi.fn().mockResolvedValue(
      createLookupPlanResult({
        shouldLookup: true,
        purpose: 'entity_grounding',
        reason: 'Need to identify the artists.',
        queries: ['Дора Мэйби Бэйби певицы кто такие'],
        confidence: 'high'
      })
    );
    const lookupProvider = {
      search: vi.fn().mockRejectedValue(new Error('network down'))
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: true }
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
        lookupContext: expect.objectContaining({
          status: 'failed',
          errorMessage: 'network down'
        })
      })
    );
  });

  test('continues with failed lookup context when planner fails', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('вердикт без поиска'));
    const planLookup = vi.fn().mockRejectedValue(new Error('planner quota'));
    const lookupProvider = {
      search: vi.fn()
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/decide',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupContext: expect.objectContaining({
          status: 'failed',
          provider: null,
          query: null,
          errorMessage: 'planner quota'
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'вердикт без поиска'
    });
  });

  test('continues with failed lookup context when planner output is malformed', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('вердикт без поиска'));
    const planLookup = vi.fn().mockResolvedValue({
      status: 'failed',
      decision: {
        shouldLookup: false,
        purpose: 'none',
        reason: 'Lookup planner returned invalid JSON.',
        queries: [],
        confidence: 'low'
      },
      model: 'planner-model',
      latencyMs: 5,
      attemptCount: 1,
      promptTokensEstimate: 30
    });
    const lookupProvider = {
      search: vi.fn()
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/decide',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupContext: expect.objectContaining({
          status: 'failed',
          provider: null,
          query: null,
          errorMessage: 'Lookup planner returned invalid JSON.'
        })
      })
    );
  });
});
