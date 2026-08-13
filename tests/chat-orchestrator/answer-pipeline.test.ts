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

  test('research path runs up to two lookups and combines their sources', async () => {
    const plan = {
      mode: 'research',
      resolvedQuestion: 'Актуальный вопрос?',
      purpose: 'freshness',
      focusClaim: 'Актуальный факт',
      queries: [
        'актуальный факт официальный источник',
        'актуальный факт независимый источник'
      ]
    };
    const search = vi.fn(async ({ query }: { query: string }) => ({
      provider: 'tavily' as const,
      query,
      sources: [
        {
          title: `Источник ${query}`,
          url: `https://example.com/${query.endsWith('источник') ? 'source' : 'other'}`,
          content: 'Факт',
          score: 0.9
        }
      ],
      responseTimeMs: 100,
      usageCredits: 1
    }));
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
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenNthCalledWith(1, {
      query: plan.queries[0],
      maxResults: 3,
      timeoutMs: 3000
    });
    expect(search).toHaveBeenNthCalledWith(2, {
      query: plan.queries[1],
      maxResults: 3,
      timeoutMs: 3000
    });
    expect(flow.generateAnswer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        research: {
          plan: expect.objectContaining({ queries: plan.queries }),
          result: expect.objectContaining({
            queries: plan.queries,
            sources: [
              expect.objectContaining({
                id: 'web_1',
                query: plan.queries[0]
              }),
              expect.objectContaining({
                id: 'web_2',
                query: plan.queries[1]
              })
            ]
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
          queries: ['запрос']
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

  test('returns fallback when the required first lookup fails', async () => {
    const queries = ['первый запрос', 'второй запрос'];
    const search = vi.fn(async ({ query }: { query: string }) => {
      if (query === queries[0]) throw new Error('first query failed');

      return {
        provider: 'tavily' as const,
        query,
        sources: [
          {
            title: 'Рабочий источник',
            url: 'https://example.com/working',
            content: 'Факт',
            score: 0.8
          }
        ],
        responseTimeMs: 100,
        usageCredits: 1
      };
    });
    const flow = setup({
      decisions: [
        {
          mode: 'research',
          resolvedQuestion: 'Вопрос',
          purpose: 'fact_check',
          focusClaim: 'Факт',
          queries
        },
        {
          mode: 'grounded',
          status: 'answered',
          outcome: 'confirmed',
          evidenceBasis: 'original_source',
          usedSourceIds: ['web_1'],
          text: 'Ответ по доступному источнику.'
        }
      ],
      lookupProvider: { search }
    });

    await flow.run();

    expect(flow.generateAnswer).toHaveBeenCalledOnce();
    expect(flow.replyDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Не смог быстро проверить это по внешним источникам.'
      })
    );
  });

  test('uses first lookup evidence when the optional second lookup fails', async () => {
    const queries = ['первый запрос', 'второй запрос'];
    const search = vi.fn(async ({ query }: { query: string }) => {
      if (query === queries[1]) throw new Error('second query failed');

      return {
        provider: 'tavily' as const,
        query,
        sources: [
          {
            title: 'Основной источник',
            url: 'https://example.com/primary',
            content: 'Факт',
            score: 0.9
          }
        ],
        responseTimeMs: 100,
        usageCredits: 1
      };
    });
    const flow = setup({
      decisions: [
        {
          mode: 'research',
          resolvedQuestion: 'Вопрос',
          purpose: 'fact_check',
          focusClaim: 'Факт',
          queries
        },
        {
          mode: 'grounded',
          status: 'answered',
          outcome: 'confirmed',
          evidenceBasis: 'original_source',
          usedSourceIds: ['web_1'],
          text: 'Ответ по основному источнику.'
        }
      ],
      lookupProvider: { search }
    });

    await flow.run();

    expect(flow.generateAnswer).toHaveBeenCalledTimes(2);
    expect(flow.generateAnswer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        research: expect.objectContaining({
          result: expect.objectContaining({
            sources: [
              expect.objectContaining({
                id: 'web_1',
                query: queries[0]
              })
            ]
          })
        })
      })
    );
  });
});
