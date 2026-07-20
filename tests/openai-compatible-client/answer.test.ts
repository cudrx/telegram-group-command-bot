import { describe, expect, test } from 'vitest';

import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import { createClientConfig, createReplyInput } from './support.js';

const answerInput = (() => {
  const {
    intent: _intent,
    lookupContext: _lookupContext,
    ...input
  } = createReplyInput('answer');

  return input;
})();

describe('OpenAiCompatibleLlmClient answer', () => {
  test('uses JSON mode for direct preflight', async () => {
    let request: Record<string, unknown> | undefined;
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            request = input;
            return completion({ mode: 'direct', text: 'Четыре.' });
          }
        }
      }
    } as never);

    await expect(client.generateAnswer(answerInput)).resolves.toMatchObject({
      decision: { mode: 'direct', text: 'Четыре.' },
      model: 'reply-model'
    });
    expect(request?.response_format).toEqual({ type: 'json_object' });
    expect(request?.model).toBe('reply-model');
  });

  test('validates grounded source ids', async () => {
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async () =>
            completion({
              mode: 'grounded',
              status: 'answered',
              outcome: 'confirmed',
              evidenceBasis: 'original_source',
              usedSourceIds: ['web_2'],
              text: 'Подтверждено.'
            })
        }
      }
    } as never);

    await expect(
      client.generateAnswer({
        ...answerInput,
        research: {
          plan: {
            resolvedQuestion: 'Вопрос',
            purpose: 'fact_check',
            focusClaim: 'Тезис',
            query: 'запрос'
          },
          result: {
            query: 'запрос',
            sources: [
              {
                id: 'web_1',
                title: 'Источник',
                url: 'https://example.com',
                content: 'Факт',
                score: 0.9
              }
            ]
          }
        }
      })
    ).rejects.toThrow('web_2');
  });
});

function completion(value: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(value) } }]
  };
}
