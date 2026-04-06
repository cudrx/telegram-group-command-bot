import OpenAI from "openai";
import { z } from "zod";

import type { StoredMessage, SummaryResult } from "../domain/models.js";
import {
  buildReplyPrompt,
  buildSummaryPrompt,
  extractJsonObject
} from "./prompts.js";

const summarySchema = z.object({
  chatSummary: z.string().min(1),
  memoryUpdates: z.array(
    z.object({
      userId: z.number().int(),
      category: z.string().min(1),
      key: z.string().min(1),
      valueText: z.string().min(1),
      stability: z.enum(["core", "durable", "volatile"]),
      sourceKind: z.enum(["explicit", "observed", "inferred"]),
      confidence: z.number().min(0).max(1),
      cardinality: z.enum(["single", "multi"])
    })
  ).default([]),
  selfMemoryUpdates: z.array(
    z.object({
      category: z.string().min(1),
      key: z.string().min(1),
      valueText: z.string().min(1),
      stability: z.enum(["core", "durable", "volatile"]),
      sourceKind: z.enum(["explicit", "observed", "inferred"]),
      confidence: z.number().min(0).max(1),
      cardinality: z.enum(["single", "multi"])
    })
  ).default([])
});

export type LlmReplyResult = {
  text: string;
  model: string;
  latencyMs: number;
  attemptCount: number;
  promptTokensEstimate: number;
};

export type LlmSummaryResult = {
  result: SummaryResult;
  model: string;
  latencyMs: number;
  attemptCount: number;
  promptTokensEstimate: number;
};

type ChatCompletionsCreate = OpenAI["chat"]["completions"]["create"];

export class OpenAiCompatibleLlmClient {
  private readonly client: OpenAI;
  private readonly createCompletion: ChatCompletionsCreate;

  constructor(
    private readonly config: {
      apiKey: string;
      baseUrl: string;
      replyModel: string;
      summaryModel: string;
      timeoutMs: number;
      maxRetries: number;
    },
    client?: OpenAI
  ) {
    this.client =
      client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: config.timeoutMs,
        maxRetries: 0
      });
    this.createCompletion = this.client.chat.completions.create.bind(
      this.client.chat.completions
    );
  }

  async generateReply(input: {
    persona: string;
    chatSummary: string | null;
    selfMemoryContext: string | null;
    participantMemoryContext: string | null;
    targetDisplayName: string;
    reason: string;
    recentMessages: StoredMessage[];
  }): Promise<LlmReplyResult> {
    const prompt = buildReplyPrompt(input);
    const startedAt = Date.now();
    const completion = await this.withRetry(() =>
      this.createCompletion({
        model: this.config.replyModel,
        temperature: 0.9,
        messages: [
          {
            role: "system",
            content:
              "You are a fun Telegram group chat character. Stay fully in character, answer naturally, and do not break the fourth wall."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    );
    const reply = completion.value.choices[0]?.message.content?.trim();

    if (!reply) {
      throw new Error("Reply model returned empty content");
    }

    return {
      text: reply,
      model: this.config.replyModel,
      latencyMs: Date.now() - startedAt,
      attemptCount: completion.attemptCount,
      promptTokensEstimate: estimateTokens(prompt)
    };
  }

  async summarizeConversation(input: {
    chatTitle: string | null;
    currentSummary: string | null;
    messages: StoredMessage[];
  }): Promise<LlmSummaryResult> {
    const prompt = buildSummaryPrompt(input);
    const startedAt = Date.now();
    const completion = await this.withRetry(() =>
      this.createCompletion({
        model: this.config.summaryModel,
        temperature: 0.2,
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content:
              "You compress group chat conversations into a short chat summary, participant memory deltas, and chat-local self-memory deltas for the bot."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    );
    const raw = completion.value.choices[0]?.message.content?.trim();

    if (!raw) {
      throw new Error("Summary model returned empty content");
    }

    return {
      result: summarySchema.parse(extractJsonObject(raw)),
      model: this.config.summaryModel,
      latencyMs: Date.now() - startedAt,
      attemptCount: completion.attemptCount,
      promptTokensEstimate: estimateTokens(prompt)
    };
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<{
    value: T;
    attemptCount: number;
  }> {
    let attemptCount = 0;

    while (true) {
      attemptCount += 1;

      try {
        return {
          value: await operation(),
          attemptCount
        };
      } catch (error) {
        if (attemptCount > this.config.maxRetries || !isRetriableError(error)) {
          throw error;
        }
      }
    }
  }
}

function estimateTokens(prompt: string): number {
  return Math.max(1, Math.ceil(prompt.length / 4));
}

function isRetriableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as {
    status?: unknown;
    code?: unknown;
    name?: unknown;
  };
  const status = typeof maybeError.status === "number" ? maybeError.status : null;
  const code = typeof maybeError.code === "string" ? maybeError.code : null;
  const name = typeof maybeError.name === "string" ? maybeError.name : null;

  if (status !== null && status >= 500) {
    return true;
  }

  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") {
    return true;
  }

  return (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT"
  );
}
