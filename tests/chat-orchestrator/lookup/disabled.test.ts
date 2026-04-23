import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createLookupPlanResult,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator lookup disabled paths', () => {
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
});
