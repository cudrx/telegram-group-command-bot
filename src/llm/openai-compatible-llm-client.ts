import OpenAI from "openai";
import { z } from "zod";

import type { ReplyContext, StoredMessage, SummaryResult } from "../domain/models.js";
import type { AppLogger } from "../logging/logger.js";
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
      summaryJsonMode: "response_format" | "prompt_only";
      timeoutMs: number;
      maxRetries: number;
    },
    client?: OpenAI,
    private readonly options: {
      logger?: AppLogger;
      logLlmText?: boolean;
    } = {}
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
    socialIntent: boolean;
    socialIntentReason: string | null;
    resolvedParticipants: Array<{
      userId: number;
      displayName: string;
    }>;
    socialParticipantContexts: Array<{
      userId: number;
      displayName: string;
      participantMemoryContext: string | null;
    }>;
    targetDisplayName: string;
    reason: string;
    replyContext: ReplyContext;
  }): Promise<LlmReplyResult> {
    const prompt = buildReplyPrompt(input);
    const startedAt = Date.now();
    this.logLlmText("llm_reply_prompt", {
      model: this.config.replyModel,
      promptText: prompt
    });
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

    this.logLlmText("llm_reply_response", {
      model: this.config.replyModel,
      responseText: reply
    });

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
    this.logLlmText("llm_summary_prompt", {
      model: this.config.summaryModel,
      promptText: prompt
    });
    const completion = await this.withRetry(() =>
      this.createCompletion({
        model: this.config.summaryModel,
        temperature: 0.2,
        ...(this.config.summaryJsonMode === "response_format"
          ? {
              response_format: {
                type: "json_object" as const
              }
            }
          : {}),
        messages: [
          {
            role: "system",
            content:
              "You compress group chat conversations into a short chat summary, participant memory deltas, and chat-local self-memory deltas for the bot. Return only a valid JSON object."
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

    this.logLlmText("llm_summary_response", {
      model: this.config.summaryModel,
      responseText: raw
    });

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
          throw enrichProviderError(error, this.config);
        }
      }
    }
  }

  private logLlmText(event: string, payload: {
    model: string;
    promptText?: string;
    responseText?: string;
  }): void {
    if (!this.options.logLlmText) {
      return;
    }

    this.options.logger?.info(event, payload);
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

function enrichProviderError(
  error: unknown,
  config: {
    apiKey: string;
    baseUrl: string;
    replyModel: string;
    summaryModel: string;
    summaryJsonMode: "response_format" | "prompt_only";
    timeoutMs: number;
    maxRetries: number;
  }
): unknown {
  if (!error || typeof error !== "object") {
    return error;
  }

  const maybeError = error as Error & { status?: unknown };
  const status =
    typeof maybeError.status === "number" ? maybeError.status : undefined;
  const message = typeof maybeError.message === "string" ? maybeError.message : "";

  if (status !== 400) {
    return error;
  }

  const hints: string[] = [];

  if (isGeminiBaseUrl(config.baseUrl)) {
    hints.push(
      "Gemini OpenAI-compatible endpoint detected. Verify LLM_BASE_URL points to https://generativelanguage.googleapis.com/v1beta/openai/ and that LLM_API_KEY is a real Gemini API key, not a placeholder."
    );

    if (config.summaryJsonMode === "response_format") {
      hints.push(
        "If reply requests start working but summary requests still fail, switch LLM_SUMMARY_JSON_MODE=prompt_only."
      );
    }
  }

  if (looksLikePlaceholderApiKey(config.apiKey)) {
    hints.push(
      "LLM_API_KEY still looks like a placeholder value and should be replaced before runtime."
    );
  }

  if (hints.length === 0) {
    return error;
  }

  const enriched = new Error(`${message} ${hints.join(" ")}`.trim(), {
    cause: error
  });

  enriched.name = maybeError.name;

  return Object.assign(enriched, {
    status
  });
}

function isGeminiBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes("generativelanguage.googleapis.com");
}

function looksLikePlaceholderApiKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return normalized.startsWith("your-") || normalized.includes("placeholder");
}
