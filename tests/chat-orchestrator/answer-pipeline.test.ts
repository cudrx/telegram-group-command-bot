import { describe, expect, test, vi } from 'vitest';

import type { LookupProvider } from '../../src/lookup/types.js';
import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from './support.js';

function setup(input: {
  decisions: unknown[];
  lookupProvider?: LookupProvider | null;
}) {
  const db = new FakeDatabaseClient();
  db.saveIncomingMessage(
    createIncomingMessage({ messageId: 1, text: 'вопрос?' })
  );
  const generateAnswer = vi.fn();

  for (const decision of input.decisions) {
    generateAnswer.mockResolvedValueOnce({
      decision,
      model: 'reply-model',
      latencyMs: 5,
      attemptCount: 1,
      promptTokensEstimate: 20
    });
  }

  const generateReply = vi.fn().mockResolvedValue(createReplyResult('старый'));
  const planLookup = vi.fn();
  const replyDispatcher = vi.fn().mockResolvedValue({
    messageId: 1001,
    createdAt: '2026-04-03T12:00:30.000Z'
  });
  const lookupProvider: LookupProvider | null =
    input.lookupProvider === undefined
      ? { search: vi.fn() }
      : input.lookupProvider;
  const orchestrator = createOrchestrator({
    db,
    qwen: { generateReply, planLookup, generateAnswer },
    lookupProvider,
    replyDispatcher
  });

  return {
    generateAnswer,
    generateReply,
    planLookup,
    lookupProvider,
    replyDispatcher,
    run: () =>
      orchestrator.handleIncomingMessage(
        createIncomingMessage({
          messageId: 2,
          text: '/answer',
          entities: [{ type: 'bot_command', offset: 0, length: 7 }],
          replyToMessageId: 1,
          replyToUserId: 42
        })
      )
  };
}

describe('ChatOrchestrator answer pipeline', () => {
  test('direct path uses one model call and no lookup', async () => {
    const flow = setup({ decisions: [{ mode: 'direct', text: 'Ответ.' }] });

    await flow.run();

    expect(flow.generateAnswer).toHaveBeenCalledOnce();
    expect(flow.generateReply).not.toHaveBeenCalled();
    expect(flow.planLookup).not.toHaveBeenCalled();
    expect(flow.lookupProvider?.search).not.toHaveBeenCalled();
    expect(flow.replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Ответ.'
    });
  });

  test('research path uses one lookup and a second model call', async () => {
    const plan = {
      mode: 'research',
      resolvedQuestion: 'Актуальный вопрос?',
      purpose: 'freshness',
      focusClaim: 'Актуальный факт',
      query: 'актуальный факт официальный источник'
    };
    const search = vi.fn().mockResolvedValue({
      provider: 'tavily',
      query: plan.query,
      sources: [
        {
          title: 'Источник',
          url: 'https://example.com',
          content: 'Факт',
          score: 0.9
        }
      ],
      responseTimeMs: 100,
      usageCredits: 1
    });
    const flow = setup({
      decisions: [
        plan,
        {
          mode: 'grounded',
          status: 'answered',
          outcome: 'confirmed',
          evidenceBasis: 'original_source',
          usedSourceIds: ['web_1'],
          text: 'Проверенный ответ.'
        }
      ],
      lookupProvider: { search }
    });

    await flow.run();

    expect(flow.generateAnswer).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledWith({
      query: plan.query,
      maxResults: 3,
      timeoutMs: 3000
    });
    expect(flow.generateAnswer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        research: {
          plan: expect.objectContaining({ query: plan.query }),
          result: expect.objectContaining({
            sources: [expect.objectContaining({ id: 'web_1' })]
          })
        }
      })
    );
    expect(flow.replyDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Проверенный ответ.' })
    );
  });

  test('lookup failure returns a local answer without a second model call', async () => {
    const flow = setup({
      decisions: [
        {
          mode: 'research',
          resolvedQuestion: 'Вопрос',
          purpose: 'freshness',
          focusClaim: 'Факт',
          query: 'запрос'
        }
      ],
      lookupProvider: {
        search: vi.fn().mockRejectedValue(new Error('network down'))
      }
    });

    await flow.run();

    expect(flow.generateAnswer).toHaveBeenCalledOnce();
    expect(flow.replyDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Не смог быстро проверить это по внешним источникам.'
      })
    );
  });
});
