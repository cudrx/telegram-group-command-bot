import { describe, expect, test, vi } from "vitest";

import { OpenAiCompatibleLlmClient } from "../src/llm/openai-compatible-llm-client.js";

describe("OpenAiCompatibleLlmClient", () => {
  test("logs reply prompt and response text when tracing is enabled", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn()
    };

    logger.child.mockReturnValue(logger);

    const client = new OpenAiCompatibleLlmClient(
      createClientConfig(),
      createOpenAiStub("ready"),
      {
        logger,
        logLlmText: true
      }
    );

    await client.generateReply(createReplyInput());

    expect(logger.info).toHaveBeenCalledWith(
      "llm.reply.request",
      expect.objectContaining({
        kind: "reply",
        prompt: expect.any(String),
        model: "reply-model"
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "llm.reply.response",
      expect.objectContaining({
        kind: "reply",
        response: "ready",
        model: "reply-model"
      })
    );
  });

  test("retries retryable completion errors once", async () => {
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

    await expect(client.generateReply(createReplyInput())).resolves.toMatchObject({
      text: "ready",
      model: "reply-model",
      attemptCount: 2
    });
    expect(calls).toBe(2);
  });

  test("uses only reply request settings", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAiCompatibleLlmClient(
      createClientConfig(),
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

    await client.generateReply(createReplyInput());

    expect(requestBody?.model).toBe("reply-model");
    expect(requestBody?.temperature).toBe(0.6);
    expect(JSON.stringify(requestBody)).not.toContain("summary");
    expect(JSON.stringify(requestBody)).not.toContain("intervention");
  });
});

function createClientConfig() {
  return {
    apiKey: "key",
    baseUrl: "https://example.com",
    replyModel: "reply-model",
    replyTemperature: 0.6,
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

function createReplyInput() {
  return {
    persona: "Persona",
    targetDisplayName: "Tom",
    reason: "mention",
    replyContext: {
      triggerMessage: {
        chatId: 1,
        messageId: 3,
        userId: 42,
        senderDisplayName: "Tom",
        text: "@fun_bot привет",
        createdAt: "2026-04-03T12:02:00.000Z",
        isBot: false,
        replyToMessageId: null
      },
      anchorBotMessage: null,
      anchorParentMessage: null,
      priorContextMessages: []
    }
  };
}
