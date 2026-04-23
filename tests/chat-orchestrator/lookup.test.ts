import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createLookupPlanResult,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from './support.js';

describe('ChatOrchestrator lookup', () => {
  test('does not plan lookup for summarize', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('коротко'));
    const planLookup = vi.fn().mockResolvedValue(
      createLookupPlanResult({
        shouldLookup: true,
        purpose: 'entity_grounding',
        reason: 'Should not be called for summarize.',
        queries: ['ignored'],
        confidence: 'high'
      })
    );
    const lookupProvider = {
      search: vi.fn().mockResolvedValue({
        provider: 'tavily',
        query: 'ignored',
        sources: [],
        responseTimeMs: 1,
        usageCredits: 1
      })
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
        text: '/summarize',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }]
      })
    );

    expect(planLookup).not.toHaveBeenCalled();
    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'summarize',
        lookupContext: null
      })
    );
  });

  test('does not plan lookup when lookup is disabled', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('вердикт'));
    const planLookup = vi.fn();
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
      env: { lookupEnabled: false }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/decide',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(planLookup).not.toHaveBeenCalled();
    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'decide',
        lookupContext: null
      })
    );
  });

  test('plans and uses Tavily lookup for decide when planner requests it', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'кто лучше дора или мейби бэйби?',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );

    const decision = {
      shouldLookup: true,
      purpose: 'entity_grounding' as const,
      reason: 'Need to identify the artists.',
      queries: ['Дора Мэйби Бэйби певицы кто такие'],
      confidence: 'high' as const
    };
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('вердикт'));
    const planLookup = vi
      .fn()
      .mockResolvedValue(createLookupPlanResult(decision));
    const lookupProvider = {
      search: vi.fn().mockResolvedValue({
        provider: 'tavily',
        query: 'Дора Мэйби Бэйби певицы кто такие',
        sources: [
          {
            title: 'Дора (певица)',
            url: 'https://example.com/dora',
            content: 'Дора - российская певица.',
            score: 0.91
          }
        ],
        responseTimeMs: 321,
        usageCredits: 1
      })
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
      env: {
        lookupEnabled: true,
        lookupMaxResults: 3,
        lookupTimeoutMs: 7000
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/decide',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(planLookup).toHaveBeenCalledWith({
      intent: 'decide',
      replyContext: expect.objectContaining({
        priorContextMessages: [expect.objectContaining({ messageId: 1 })]
      })
    });
    expect(lookupProvider.search).toHaveBeenCalledWith({
      query: 'Дора Мэйби Бэйби певицы кто такие',
      maxResults: 3,
      timeoutMs: 7000
    });
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'decide',
        lookupContext: expect.objectContaining({
          status: 'used',
          provider: 'tavily',
          query: 'Дора Мэйби Бэйби певицы кто такие',
          sources: [
            expect.objectContaining({
              title: 'Дора (певица)',
              url: 'https://example.com/dora'
            })
          ]
        })
      })
    );
  });

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
