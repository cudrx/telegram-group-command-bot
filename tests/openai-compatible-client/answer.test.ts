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

  test('keeps answer instructions in the system message and chat data in the user message', async () => {
    let request: Record<string, unknown> | undefined;
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            request = input;
            return completion({ mode: 'direct', text: 'Ответ.' });
          }
        }
      }
    } as never);

    await client.generateAnswer({
      ...answerInput,
      assistantInstructions: 'unique assistant policy',
      replyContext: {
        ...answerInput.replyContext,
        replyAnchorMessage: {
          chatId: 1,
          messageId: 2,
          userId: 7,
          senderDisplayName: 'Alice',
          text: 'unique untrusted target message',
          createdAt: '2026-04-03T12:00:00.000Z',
          isBot: false,
          replyToMessageId: null
        }
      }
    });

    const messages = request?.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0]).toMatchObject({ role: 'system' });
    expect(messages[0]?.content).toContain('unique assistant policy');
    expect(messages[0]?.content).not.toContain(
      'unique untrusted target message'
    );
    expect(messages[1]).toMatchObject({ role: 'user' });
    expect(messages[1]?.content).toContain('unique untrusted target message');
    expect(messages[1]?.content).not.toContain('unique assistant policy');
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
            queries: ['запрос']
          },
          result: {
            queries: ['запрос'],
            sources: [
              {
                id: 'web_1',
                query: 'запрос',
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

  test('rejects research plans with more than two queries', async () => {
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async () =>
            completion({
              mode: 'research',
              resolvedQuestion: 'Вопрос',
              purpose: 'fact_check',
              focusClaim: 'Тезис',
              queries: ['первый', 'второй', 'третий']
            })
        }
      }
    } as never);

    await expect(client.generateAnswer(answerInput)).rejects.toThrow();
  });
});

function completion(value: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(value) } }]
  };
}
