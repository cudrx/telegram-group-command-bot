import { describe, expect, test } from "vitest";

import { OpenAiCompatibleLlmClient } from "../src/llm/openai-compatible-llm-client.js";

describe("OpenAiCompatibleLlmClient", () => {
  test("retries retryable completion errors once", async () => {
    let calls = 0;
    const client = new OpenAiCompatibleLlmClient(
      {
        apiKey: "key",
        baseUrl: "https://example.com",
        replyModel: "reply-model",
        summaryModel: "summary-model",
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
        targetDisplayName: "Tom",
        reason: "mention",
        recentMessages: []
      })
    ).resolves.toMatchObject({
      text: "ready",
      model: "reply-model",
      attemptCount: 2
    });

    expect(calls).toBe(2);
  });

  test("parses structured memory updates from summary output", async () => {
    const client = new OpenAiCompatibleLlmClient(
      {
        apiKey: "key",
        baseUrl: "https://example.com",
        replyModel: "reply-model",
        summaryModel: "summary-model",
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
            })
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
  });

  test("does not retry schema errors from summary parsing", async () => {
    let calls = 0;
    const client = new OpenAiCompatibleLlmClient(
      {
        apiKey: "key",
        baseUrl: "https://example.com",
        replyModel: "reply-model",
        summaryModel: "summary-model",
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
});
