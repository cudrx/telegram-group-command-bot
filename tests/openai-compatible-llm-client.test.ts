import { describe, expect, test, vi } from "vitest";

import { OpenAiCompatibleLlmClient } from "../src/llm/openai-compatible-llm-client.js";

describe("OpenAiCompatibleLlmClient", () => {
  test("logs prompt and response text when tracing is enabled", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn()
    };

    logger.child.mockReturnValue(logger);

    const client = new OpenAiCompatibleLlmClient(
      {
        apiKey: "key",
        baseUrl: "https://example.com",
        replyModel: "reply-model",
        summaryModel: "summary-model",
        summaryJsonMode: "response_format",
        timeoutMs: 20_000,
        maxRetries: 1
      },
      {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: "ready"
                  }
                }
              ]
            })
          }
        }
      } as never,
      {
        logger,
        logLlmText: true
      }
    );

    await client.generateReply({
      persona: "Persona",
      chatSummary: null,
      selfMemoryContext: null,
      participantMemoryContext: null,
      socialIntent: false,
      socialIntentReason: null,
      resolvedParticipants: [],
      socialParticipantContexts: [],
      targetDisplayName: "Tom",
      reason: "mention",
      replyContext: createReplyContext()
    });

    expect(logger.info).toHaveBeenCalledWith(
      "llm_reply_prompt",
      expect.objectContaining({
        promptText: expect.any(String),
        model: "reply-model"
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "llm_reply_response",
      expect.objectContaining({
        responseText: "ready",
        model: "reply-model"
      })
    );
  });

  test("retries retryable completion errors once", async () => {
    let calls = 0;
    const client = new OpenAiCompatibleLlmClient(
      {
        apiKey: "key",
        baseUrl: "https://example.com",
        replyModel: "reply-model",
        summaryModel: "summary-model",
        summaryJsonMode: "response_format",
        timeoutMs: 20_000,
        maxRetries: 1
      },
      {
        chat: {
          completions: {
            create: async () => {
              calls += 1;

              if (calls === 1) {
                const error = new Error("temporary failure") as Error & {
                  status: number;
                };

                error.status = 500;
                throw error;
              }

              return {
                choices: [
                  {
                    message: {
                      content: "ready"
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
      client.generateReply({
        persona: "Persona",
        chatSummary: null,
        selfMemoryContext: null,
        participantMemoryContext: null,
        socialIntent: false,
        socialIntentReason: null,
        resolvedParticipants: [],
        socialParticipantContexts: [],
        targetDisplayName: "Tom",
        reason: "mention",
        replyContext: createReplyContext()
      })
    ).resolves.toMatchObject({
      text: "ready",
      model: "reply-model",
      attemptCount: 2
    });

    expect(calls).toBe(2);
  });

  test("uses neutral reply request settings without anti-loop system prompt wording", async () => {
    let requestBody: Record<string, unknown> | undefined;

    const client = new OpenAiCompatibleLlmClient(
      {
        apiKey: "key",
        baseUrl: "https://example.com",
        replyModel: "reply-model",
        summaryModel: "summary-model",
        summaryJsonMode: "response_format",
        timeoutMs: 20_000,
        maxRetries: 1
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
                      content: "ready"
                    }
                  }
                ]
              };
            }
          }
        }
      } as never
    );

    await client.generateReply({
      persona: "Persona",
      chatSummary: null,
      selfMemoryContext: null,
      participantMemoryContext: null,
      socialIntent: false,
      socialIntentReason: null,
      resolvedParticipants: [],
      socialParticipantContexts: [],
      targetDisplayName: "Tom",
      reason: "reply_to_bot",
      replyContext: createReplyContext({
        triggerMessage: {
          chatId: 1,
          messageId: 3,
          userId: 42,
          senderDisplayName: "Tom",
          text: "почему кот",
          createdAt: "2026-04-03T12:02:00.000Z",
          isBot: false,
          replyToMessageId: 2
        },
        anchorBotMessage: {
          chatId: 1,
          messageId: 2,
          userId: 77,
          senderDisplayName: "Хрюпа",
          text: "кривой ответ",
          createdAt: "2026-04-03T12:01:00.000Z",
          isBot: true,
          replyToMessageId: 1
        },
        anchorParentMessage: {
          chatId: 1,
          messageId: 1,
          userId: 42,
          senderDisplayName: "Tom",
          text: "ну чо",
          createdAt: "2026-04-03T12:00:00.000Z",
          isBot: false,
          replyToMessageId: null
        },
        priorContextMessages: [
          {
            chatId: 1,
            messageId: 1,
            userId: 42,
            senderDisplayName: "Tom",
            text: "ну чо",
            createdAt: "2026-04-03T12:00:00.000Z",
            isBot: false,
            replyToMessageId: null
          }
        ]
      })
    });

    expect(requestBody?.temperature).toBe(0.9);
    expect(requestBody?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content:
            "You are a fun Telegram group chat character. Stay fully in character, answer naturally, and do not break the fourth wall."
        })
      ])
    );
    expect(JSON.stringify(requestBody?.messages)).not.toContain(
      "avoid getting stuck in repeated metaphors or phrasing"
    );
  });

  test("parses structured memory updates from summary output", async () => {
    let requestBody: Record<string, unknown> | undefined;

    const client = new OpenAiCompatibleLlmClient(
      {
        apiKey: "key",
        baseUrl: "https://example.com",
        replyModel: "reply-model",
        summaryModel: "summary-model",
        summaryJsonMode: "response_format",
        timeoutMs: 20_000,
        maxRetries: 1
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
                      content: JSON.stringify({
                        chatSummary: "test",
                        memoryUpdates: [
                          {
                            userId: 42,
                            category: "preference",
                            key: "favorite_club",
                            valueText: "Liverpool",
                            stability: "durable",
                            sourceKind: "explicit",
                            confidence: 0.9,
                            cardinality: "single"
                          }
                        ],
                        selfMemoryUpdates: [
                          {
                            category: "relationship",
                            key: "running_joke_with_tom",
                            valueText: "teases Tom about deadlines",
                            stability: "durable",
                            sourceKind: "observed",
                            confidence: 0.81,
                            cardinality: "single"
                          }
                        ]
                      })
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
      client.summarizeConversation({
        chatTitle: "Friends",
        currentSummary: null,
        messages: []
      })
    ).resolves.toMatchObject({
      result: {
        chatSummary: "test",
        memoryUpdates: [
          {
            userId: 42,
            key: "favorite_club"
          }
        ],
        selfMemoryUpdates: [
          {
            key: "running_joke_with_tom"
          }
        ]
      }
    });

    expect(requestBody?.response_format).toEqual({ type: "json_object" });
  });

  test("omits response_format in prompt_only summary mode", async () => {
    let requestBody: Record<string, unknown> | undefined;

    const client = new OpenAiCompatibleLlmClient(
      {
        apiKey: "key",
        baseUrl: "https://example.com",
        replyModel: "reply-model",
        summaryModel: "summary-model",
        summaryJsonMode: "prompt_only",
        timeoutMs: 20_000,
        maxRetries: 1
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
                        '```json\n{"chatSummary":"test","memoryUpdates":[],"selfMemoryUpdates":[]}\n```'
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
      client.summarizeConversation({
        chatTitle: "Friends",
        currentSummary: null,
        messages: []
      })
    ).resolves.toMatchObject({
      result: {
        chatSummary: "test",
        memoryUpdates: [],
        selfMemoryUpdates: []
      }
    });

    expect(requestBody).not.toHaveProperty("response_format");
  });

  test("does not retry schema errors from summary parsing", async () => {
    let calls = 0;
    const client = new OpenAiCompatibleLlmClient(
      {
        apiKey: "key",
        baseUrl: "https://example.com",
        replyModel: "reply-model",
        summaryModel: "summary-model",
        summaryJsonMode: "response_format",
        timeoutMs: 20_000,
        maxRetries: 1
      },
      {
        chat: {
          completions: {
            create: async () => {
              calls += 1;

              return {
                choices: [
                  {
                    message: {
                      content: '{"memoryUpdates":[]}'
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
      client.summarizeConversation({
        chatTitle: "Friends",
        currentSummary: null,
        messages: []
      })
    ).rejects.toThrow();

    expect(calls).toBe(1);
  });

  test("adds Gemini-specific diagnostics to bare 400 provider errors", async () => {
    const client = new OpenAiCompatibleLlmClient(
      {
        apiKey: "real-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
        replyModel: "gemini-2.5-flash",
        summaryModel: "gemini-2.5-flash",
        summaryJsonMode: "response_format",
        timeoutMs: 20_000,
        maxRetries: 0
      },
      {
        chat: {
          completions: {
            create: async () => {
              const error = new Error("400 status code (no body)") as Error & {
                status: number;
              };

              error.status = 400;
              throw error;
            }
          }
        }
      } as never
    );

    await expect(
      client.generateReply({
        persona: "Persona",
        chatSummary: null,
        selfMemoryContext: null,
        participantMemoryContext: null,
        socialIntent: false,
        socialIntentReason: null,
        resolvedParticipants: [],
        socialParticipantContexts: [],
        targetDisplayName: "Tom",
        reason: "mention",
        replyContext: createReplyContext()
      })
    ).rejects.toThrow(/Gemini|LLM_API_KEY|LLM_BASE_URL/i);
  });
});

function createReplyContext(overrides: Partial<{
  triggerMessage: {
    chatId: number;
    messageId: number;
    userId: number | null;
    senderDisplayName: string;
    text: string;
    createdAt: string;
    isBot: boolean;
    replyToMessageId: number | null;
  } | null;
  anchorBotMessage: {
    chatId: number;
    messageId: number;
    userId: number | null;
    senderDisplayName: string;
    text: string;
    createdAt: string;
    isBot: boolean;
    replyToMessageId: number | null;
  } | null;
  anchorParentMessage: {
    chatId: number;
    messageId: number;
    userId: number | null;
    senderDisplayName: string;
    text: string;
    createdAt: string;
    isBot: boolean;
    replyToMessageId: number | null;
  } | null;
  priorContextMessages: Array<{
    chatId: number;
    messageId: number;
    userId: number | null;
    senderDisplayName: string;
    text: string;
    createdAt: string;
    isBot: boolean;
    replyToMessageId: number | null;
  }>;
}> = {}) {
  return {
    triggerMessage: null,
    anchorBotMessage: null,
    anchorParentMessage: null,
    priorContextMessages: [],
    ...overrides
  };
}
