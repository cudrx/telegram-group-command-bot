import { describe, expect, test } from 'vitest';
import { buildAssistantContext } from '../../src/app/assistant-context.js';
import type { StoredMessage } from '../../src/domain/models.js';
import { buildAnswerMessages } from '../../src/llm/openai-compatible-client/answer.js';
import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import { estimateTokens } from '../../src/llm/openai-compatible-client/logging.js';
import { loadAssistantInstructions } from '../../src/llm/prompt-files.js';
import { createClientConfig, createReplyInput } from './support.js';

const answerInput = (() => {
  const { intent: _intent, ...input } = createReplyInput('translate');

  return input;
})();

describe('OpenAiCompatibleLlmClient answer', () => {
  test.each([
    { mode: 'direct', text: 'Ответ.' },
    { mode: 'clarify', text: 'О чём речь?' },
    {
      mode: 'research',
      resolvedQuestion: 'Есть ли транзакции в PostgreSQL?',
      purpose: 'fact_check',
      focusClaim: 'PostgreSQL поддерживает транзакции',
      queries: ['PostgreSQL transactions docs']
    }
  ])('normalizes a numeric context array for $mode without another completion', async (decision) => {
    let calls = 0;
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async () => {
            calls++;
            return completion({ ...decision, context: [1] });
          }
        }
      }
    } as never);
    const result = await client.generateAnswer({
      ...answerInput,
      replyContext: {
        ...answerInput.replyContext,
        priorContextMessages: [
          message(1, 'PostgreSQL поддерживает транзакции.')
        ]
      }
    });
    expect(result.decision).toMatchObject({
      mode: decision.mode,
      context: { messageIds: [1] }
    });
    expect(calls).toBe(1);
  });

  test('normalizes an empty context array for a request without history', async () => {
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async () =>
            completion({ mode: 'clarify', context: [], text: 'Чем помочь?' })
        }
      }
    } as never);
    await expect(client.generateAnswer(answerInput)).resolves.toMatchObject({
      decision: {
        mode: 'clarify',
        context: { messageIds: [] },
        text: 'Чем помочь?'
      }
    });
  });

  test.each([
    ['1'],
    [{ messageId: 1 }],
    [0],
    Array.from({ length: 65 }, () => 1),
    [987654]
  ])('rejects invalid or unavailable IDs in a context array: %j', async (...context) => {
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async () =>
            completion({ mode: 'direct', context, text: 'Ответ.' })
        }
      }
    } as never);
    await expect(client.generateAnswer(answerInput)).rejects.toThrow();
  });

  test('keeps relevant older context when neighboring media fills the budget', () => {
    const terms =
      'PostgreSQL transactions payments consistency indexing constraints durability atomicity isolation persistence';
    const history = Array.from({ length: 16 }, (_, i) =>
      message(
        i + 1,
        i === 0 ? `${terms}${'а'.repeat(500)}` : `Погода ${'б'.repeat(500)}`
      )
    );
    const context = buildAssistantContext({
      db: {
        getMessagesBefore: (_chatId, id, limit) =>
          history.filter((m) => m.messageId < id).slice(-limit),
        getMessageByTelegramMessageId: (_chatId, id) =>
          history.find((m) => m.messageId === id) ?? null
      },
      triggerMessage: message(17, `@bot ${terms} почему?`),
      contextLimit: 80,
      botUserId: 77
    });
    context.priorContextMessages = context.priorContextMessages.map((m) =>
      m.messageId >= 12
        ? { ...m, text: `${m.text}\n[media] ${'в'.repeat(5000)}` }
        : m
    );
    const messages = buildAnswerMessages({
      ...answerInput,
      replyContext: context
    });
    expect(messages[1]?.content).toContain(terms);
    expect(messages[1]?.content).toContain('messageId=1 ');
  });

  test('makes room for target audio by dropping optional history', () => {
    const messages = buildAnswerMessages({
      ...answerInput,
      assistantInstructions: loadAssistantInstructions(),
      replyContext: {
        triggerMessage: message(21, '@bot подведи итог голосового'),
        replyAnchorMessage: null,
        priorContextMessages: Array.from({ length: 20 }, (_, i) =>
          message(i + 1, 'История '.repeat(70))
        )
      },
      mediaContext: {
        sourceCaption: null,
        visionDescription: null,
        ocrTextRu: null,
        ocrTextDefault: null,
        visionRaw: null,
        visionInterpretation: null,
        audioTranscript: {
          transcript: 'Содержание записи '.repeat(900),
          language: 'ru',
          sourceDurationSeconds: 900
        }
      }
    });
    expect(messages[1]?.content).toContain('Содержание записи');
    expect(
      estimateTokens(messages.map((m) => m.content).join('\n\n'))
    ).toBeLessThanOrEqual(16000);
    expect(messages[1]?.content).toContain('contextTruncated=true');
  });

  test('rejects oversized prompts before calling the provider', async () => {
    let calls = 0;
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async () => {
            calls++;
            return completion({
              mode: 'direct',
              context: { messageIds: [] },
              text: 'Ответ'
            });
          }
        }
      }
    } as never);
    await expect(
      client.generateAnswer({
        ...answerInput,
        assistantInstructions: 'Большие инструкции '.repeat(10000)
      })
    ).rejects.toThrow('token budget');
    expect(calls).toBe(0);
  });

  test('rejects an ID whose candidate belongs to another chat', async () => {
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async () =>
            completion({
              mode: 'direct',
              context: { messageIds: [20] },
              text: 'Ответ'
            })
        }
      }
    } as never);
    await expect(
      client.generateAnswer({
        ...answerInput,
        replyContext: {
          ...answerInput.replyContext,
          priorContextMessages: [
            {
              chatId: 999,
              messageId: 20,
              userId: 1,
              senderDisplayName: 'Other',
              text: 'private',
              createdAt: '2026-10-24T12:00:00Z',
              isBot: false,
              replyToMessageId: null
            }
          ]
        }
      })
    ).rejects.toThrow('20');
  });
  test('rejects selected conversation ids outside the supplied candidates', async () => {
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async () =>
            completion({
              mode: 'direct',
              context: { messageIds: [987654] },
              text: 'Ответ.'
            })
        }
      }
    } as never);
    await expect(client.generateAnswer(answerInput)).rejects.toThrow('987654');
  });

  test('supports a clarification decision without web search', async () => {
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async () =>
            completion({
              mode: 'clarify',
              context: { messageIds: [] },
              text: 'О каком обсуждении речь?'
            })
        }
      }
    } as never);
    await expect(client.generateAnswer(answerInput)).resolves.toMatchObject({
      decision: { mode: 'clarify', text: 'О каком обсуждении речь?' }
    });
  });

  test('includes the complete mention request and target audio in conversation data', async () => {
    let messages: Array<{ role: string; content: string }> = [];
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async (input: { messages: typeof messages }) => {
            messages = input.messages;
            return completion({
              mode: 'direct',
              context: { messageIds: [] },
              text: 'Ответ.'
            });
          }
        }
      }
    } as never);
    await client.generateAnswer({
      ...answerInput,
      replyContext: {
        ...answerInput.replyContext,
        triggerMessage: {
          chatId: 1,
          messageId: 3,
          userId: 42,
          senderDisplayName: 'Tom',
          createdAt: '2026-10-24T12:00:00Z',
          isBot: false,
          replyToMessageId: null,
          text: '@fun_bot объясни именно эту шутку'
        }
      },
      mediaContext: {
        sourceCaption: null,
        visionDescription: null,
        ocrTextRu: null,
        ocrTextDefault: null,
        visionRaw: null,
        visionInterpretation: null,
        audioTranscript: {
          transcript: 'unique audio text',
          language: 'ru',
          sourceDurationSeconds: 3
        }
      }
    });
    expect(messages[1]?.content).toContain('объясни именно эту шутку');
    expect(messages[1]?.content).toContain('unique audio text');
  });
  test('uses JSON mode for direct preflight', async () => {
    let request: Record<string, unknown> | undefined;
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            request = input;
            return completion({
              mode: 'direct',
              context: { messageIds: [] },
              text: 'Четыре.'
            });
          }
        }
      }
    } as never);

    await expect(client.generateAnswer(answerInput)).resolves.toMatchObject({
      decision: {
        mode: 'direct',
        context: { messageIds: [] },
        text: 'Четыре.'
      },
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
            return completion({
              mode: 'direct',
              context: { messageIds: [] },
              text: 'Ответ.'
            });
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

function message(messageId: number, text: string): StoredMessage {
  return {
    chatId: 1,
    messageId,
    userId: 42,
    senderDisplayName: 'User',
    text,
    createdAt: '2026-10-24T10:00:00Z',
    isBot: false,
    replyToMessageId: null
  };
}
