import { describe, expect, test } from 'vitest';

import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import {
  createClientConfig,
  createOpenAiStub,
  createReplyInput
} from './support.js';

describe('OpenAiCompatibleLlmClient lookup', () => {
  test('plans lookup with planner model, JSON settings, and thinking disabled', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAiCompatibleLlmClient(
      {
        ...createClientConfig(),
        plannerModel: 'planner-model',
        lookupMaxQueries: 1
      },
      {
        chat: {
          completions: {
            create: async (input: Record<string, unknown>) => {
              requestBody = input;

              return {
                choices: [
                  {
                    message: {
                      content:
                        '{"shouldLookup":true,"purpose":"entity_grounding","reason":"Need grounding.","queries":["Дора Мэйби Бэйби певицы кто такие"],"confidence":"medium"}'
                    }
                  }
                ]
              };
            }
          }
        }
      } as never
    );

    const result = await client.planLookup({
      intent: 'decide',
      replyContext: createReplyInput().replyContext
    });

    expect(result.decision).toEqual({
      shouldLookup: true,
      purpose: 'entity_grounding',
      reason: 'Need grounding.',
      queries: ['Дора Мэйби Бэйби певицы кто такие'],
      confidence: 'medium'
    });
    expect(result.model).toBe('planner-model');
    expect(result.attemptCount).toBe(1);
    expect(requestBody?.model).toBe('planner-model');
    expect(requestBody?.temperature).toBe(0);
    expect(requestBody?.max_tokens).toBe(500);
    expect(requestBody?.enable_thinking).toBe(false);
  });

  test('marks planner result as failed when planner returns empty content', async () => {
    const client = new OpenAiCompatibleLlmClient(
      {
        ...createClientConfig(),
        plannerModel: 'planner-model',
        lookupMaxQueries: 1
      },
      {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: ''
                  }
                }
              ]
            })
          }
        }
      } as never
    );

    await expect(
      client.planLookup({
        intent: 'decide',
        replyContext: createReplyInput().replyContext
      })
    ).resolves.toMatchObject({
      status: 'failed',
      decision: {
        shouldLookup: false,
        purpose: 'none',
        reason: 'Lookup planner returned empty content.',
        queries: [],
        confidence: 'low'
      }
    });
  });

  test('marks planner result as failed when planner returns invalid JSON', async () => {
    const client = new OpenAiCompatibleLlmClient(
      createClientConfig(),
      createOpenAiStub('not json')
    );

    await expect(
      client.planLookup({
        intent: 'decide',
        replyContext: createReplyInput().replyContext
      })
    ).resolves.toMatchObject({
      status: 'failed',
      decision: {
        shouldLookup: false,
        purpose: 'none',
        reason: 'Lookup planner returned invalid JSON.',
        queries: [],
        confidence: 'low'
      }
    });
  });
});
