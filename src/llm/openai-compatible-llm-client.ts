import OpenAI from "openai";

import type { ReplyContext } from "../domain/models.js";
import type { AppLogger } from "../logging/logger.js";
import { buildReplyPrompt } from "./prompts.js";

export type LlmReplyResult = {
  text: string;
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
      replyTemperature: number;
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
    targetDisplayName: string;
    reason: string;
    replyContext: ReplyContext;
  }): Promise<LlmReplyResult> {
    const prompt = buildReplyPrompt(input);
    const startedAt = Date.now();
    this.logLlmText("llm.reply.request", {
      kind: "reply",
      model: this.config.replyModel,
      temperature: this.config.replyTemperature,
      prompt
    });
    const completion = await this.withRetry(() =>
      this.createCompletion({
        model: this.config.replyModel,
        temperature: this.config.replyTemperature,
        messages: [
          {
            role: "system",
            content:
              "Ты Хрюпа в дружеском Telegram-чате. Отвечай как живой участник чата: коротко, по-русски, без ассистентского тона, литературных метафор и объяснения своей роли."
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

    this.logLlmText("llm.reply.response", {
      kind: "reply",
      model: this.config.replyModel,
      latencyMs: Date.now() - startedAt,
      attemptCount: completion.attemptCount,
      promptTokensEstimate: estimateTokens(prompt),
      response: reply
    });

    return {
      text: reply,
      model: this.config.replyModel,
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
    kind: "reply";
    model: string;
    temperature?: number;
    latencyMs?: number;
    attemptCount?: number;
    promptTokensEstimate?: number;
    prompt?: string;
    response?: string;
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
