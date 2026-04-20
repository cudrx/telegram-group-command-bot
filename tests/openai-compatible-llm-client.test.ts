import { describe, expect, test, vi } from 'vitest';

import { OpenAiCompatibleLlmClient } from '../src/llm/openai-compatible-llm-client.js';

describe('OpenAiCompatibleLlmClient', () => {
  test('logs compact reply trace without raw prompt or response fields', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn()
    };

    logger.child.mockReturnValue(logger);

    const client = new OpenAiCompatibleLlmClient(
      createClientConfig(),
      createOpenAiStub('ready'),
      {
        logger,
        logLlmText: true
      }
    );

    await client.generateReply(createReplyInput());

    expect(logger.info).toHaveBeenCalledWith(
      'llm.reply.request',
      expect.objectContaining({
        kind: 'reply',
        model: 'reply-model',
        promptChars: expect.any(Number),
        promptTokensEstimate: expect.any(Number)
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      'llm.reply.response',
      expect.objectContaining({
        kind: 'reply',
        model: 'reply-model',
        responseChars: 5,
        responsePreview: 'ready'
      })
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      'llm.reply.request',
      expect.objectContaining({
        prompt: expect.any(String)
      })
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      'llm.reply.response',
      expect.objectContaining({
        response: expect.any(String)
      })
    );
  });

  test('warns when reply output violates formatting guardrails', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn()
    };

    logger.child.mockReturnValue(logger);

    const client = new OpenAiCompatibleLlmClient(
      createClientConfig(),
      createOpenAiStub('Summary:\n**Коротко**'),
      {
        logger
      }
    );

    await client.generateReply(createReplyInput());

    expect(logger.warn).toHaveBeenCalledWith(
      'llm.reply_format_guardrail_warning',
      expect.objectContaining({
        kind: 'reply',
        model: 'reply-model',
        intent: 'decide',
        hasEnglishSummaryHeading: true,
        hasMarkdownBold: true,
        violations: expect.arrayContaining([
          'english_summary_heading',
          'markdown_bold',
          'missing_decide_shape'
        ])
      })
    );
  });

  test('warns when explain reply lacks required HTML sections', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn()
    };

    logger.child.mockReturnValue(logger);

    const client = new OpenAiCompatibleLlmClient(
      createClientConfig(),
      createOpenAiStub('Точной даты нет, уточни направление.'),
      {
        logger
      }
    );

    await client.generateReply(createReplyInput('explain'));

    expect(logger.warn).toHaveBeenCalledWith(
      'llm.reply_format_guardrail_warning',
      expect.objectContaining({
        kind: 'reply',
        model: 'reply-model',
        intent: 'explain',
        violations: expect.arrayContaining(['missing_explain_shape'])
      })
    );
  });

  test('retries retryable completion errors once', async () => {
    let calls = 0;
    const client = new OpenAiCompatibleLlmClient(
      {
        ...createClientConfig(),
        maxRetries: 1
      },
      {
        chat: {
          completions: {
            create: async () => {
              calls += 1;

              if (calls === 1) {
                const error = new Error('temporary failure') as Error & {
                  status: number;
                };

                error.status = 500;
                throw error;
              }

              return {
                choices: [
                  {
                    message: {
                      content: 'ready'
                    }
                  }
                ]
              };
            }
          }
        }
      } as never
    );

    await expect(
      client.generateReply(createReplyInput())
    ).resolves.toMatchObject({
      text: 'ready',
      model: 'reply-model',
      attemptCount: 2
    });
    expect(calls).toBe(2);
  });

  test('uses only reply request settings', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            requestBody = input;

            return {
              choices: [
                {
                  message: {
                    content: 'ready'
                  }
                }
              ]
            };
          }
        }
      }
    } as never);

    await client.generateReply(createReplyInput());

    expect(requestBody?.model).toBe('reply-model');
    expect(requestBody?.temperature).toBe(0.6);
    expect(requestBody?.enable_thinking).toBe(false);
    const messages = requestBody?.messages as
      | Array<{ role: string; content: string }>
      | undefined;

    expect(messages?.map((message) => message.role)).toEqual([
      'system',
      'user'
    ]);
    expect(messages?.[0]?.content).toContain(
      'You are a neutral Telegram assistant.'
    );
    expect(messages?.[1]?.content).toContain('Assistant instructions:');
    expect(messages?.[1]?.content).toContain('Assistant instructions');
    expect(messages?.[1]?.content).toContain('Task-specific instructions:');
    expect(JSON.stringify(requestBody)).toContain(
      'The selected task mode is: decide'
    );
    expect(JSON.stringify(requestBody)).not.toContain(
      'usually 1-2 short lines'
    );
    expect(JSON.stringify(requestBody)).not.toContain('summary');
    expect(JSON.stringify(requestBody)).not.toContain('intervention');
  });

  test('routes all reply intents to the reply model', async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            requestBodies.push(input);

            return {
              choices: [
                {
                  message: {
                    content: 'ready'
                  }
                }
              ]
            };
          }
        }
      }
    } as never);

    await client.generateReply(createReplyInput('summarize'));
    await client.generateReply(createReplyInput('explain'));
    await client.generateReply(createReplyInput('decide'));
    await client.generateReply(createReplyInput('describe'));

    expect(requestBodies.map((body) => body.model)).toEqual([
      'reply-model',
      'reply-model',
      'reply-model',
      'reply-model'
    ]);
  });

  test('formats deploy updates with the reply model', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            requestBody = input;

            return {
              choices: [
                {
                  message: {
                    content:
                      '<b>Исправлено</b>\n\n• Бот теперь понимает подписи к видео.'
                  }
                }
              ]
            };
          }
        }
      }
    } as never);

    await expect(
      client.formatDeployUpdate({
        shortSha: '9c59b85',
        commits: ['fix: handle telegram media captions']
      })
    ).resolves.toMatchObject({
      text: '<b>Исправлено</b>\n\n• Бот теперь понимает подписи к видео.',
      model: 'reply-model'
    });

    expect(requestBody).toEqual(
      expect.objectContaining({
        model: 'reply-model',
        temperature: 0.4,
        max_tokens: 500,
        enable_thinking: false
      })
    );
    expect(
      (
        requestBody?.messages as
          | Array<{ role: string; content: string }>
          | undefined
      )?.[1]?.content
    ).toContain('fix: handle telegram media captions');
  });

  test('includes lookup context in the final reply prompt', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            requestBody = input;

            return {
              choices: [
                {
                  message: {
                    content: 'ready'
                  }
                }
              ]
            };
          }
        }
      }
    } as never);

    type ReplyInput = Parameters<OpenAiCompatibleLlmClient['generateReply']>[0];
    const hasLookupContext: 'lookupContext' extends keyof ReplyInput
      ? true
      : false = true;
    void hasLookupContext;

    const replyInput = {
      assistantInstructions: 'Assistant instructions',
      targetDisplayName: 'Tom',
      intent: 'decide',
      replyContext: {
        triggerMessage: {
          chatId: 1,
          messageId: 3,
          userId: 42,
          senderDisplayName: 'Tom',
          text: '/decide кто прав',
          createdAt: '2026-04-03T12:02:00.000Z',
          isBot: false,
          replyToMessageId: null
        },
        replyAnchorMessage: null,
        priorContextMessages: []
      },
      lookupContext: {
        status: 'used',
        provider: 'tavily',
        intent: 'decide',
        decision: {
          shouldLookup: true,
          purpose: 'entity_grounding',
          reason: 'Need grounding.',
          queries: ['Дора Мэйби Бэйби певицы кто такие'],
          confidence: 'high'
        },
        query: 'Дора Мэйби Бэйби певицы кто такие',
        sources: [
          {
            title: 'Дора (певица)',
            url: 'https://example.com/dora',
            content: 'Дора - российская певица.',
            score: 0.91
          }
        ],
        responseTimeMs: 123,
        usageCredits: 1,
        errorMessage: null
      }
    } as ReplyInput & {
      lookupContext: {
        status: 'used';
        provider: 'tavily';
        intent: 'decide';
        decision: {
          shouldLookup: boolean;
          purpose: string;
          reason: string;
          queries: string[];
          confidence: 'high';
        };
        query: string;
        sources: Array<{
          title: string;
          url: string;
          content: string;
          score: number;
        }>;
        responseTimeMs: number;
        usageCredits: number;
        errorMessage: null;
      };
    };

    await client.generateReply(replyInput);

    const prompt =
      (
        requestBody?.messages as
          | Array<{ role: string; content: string }>
          | undefined
      )?.[1]?.content ?? '';

    expect(prompt).toContain('EXTERNAL_LOOKUP_CONTEXT:');
    expect(prompt).toContain('purpose=entity_grounding');
    expect(prompt).toContain('title="Дора (певица)"');
    expect(prompt).toContain('url="https://example.com/dora"');
  });

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

function createClientConfig() {
  return {
    apiKey: 'key',
    baseUrl: 'https://example.com',
    replyModel: 'reply-model',
    replyTemperature: 0.6,
    replyEnableThinking: false,
    plannerModel: 'planner-model',
    lookupMaxQueries: 1,
    timeoutMs: 20_000,
    maxRetries: 1
  };
}

function createOpenAiStub(content: string) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content
              }
            }
          ]
        })
      }
    }
  } as never;
}

function createReplyInput(
  intent: 'explain' | 'summarize' | 'decide' | 'describe' = 'decide'
) {
  return {
    assistantInstructions: 'Assistant instructions',
    targetDisplayName: 'Tom',
    intent,
    replyContext: {
      triggerMessage: {
        chatId: 1,
        messageId: 3,
        userId: 42,
        senderDisplayName: 'Tom',
        text: '/decide кто прав',
        createdAt: '2026-04-03T12:02:00.000Z',
        isBot: false,
        replyToMessageId: null
      },
      replyAnchorMessage: null,
      priorContextMessages: []
    },
    mediaContext:
      intent === 'describe'
        ? {
            sourceCaption: null,
            visibleText: [],
            visualDetails: null,
            audioTranscript: null
          }
        : null
  };
}
