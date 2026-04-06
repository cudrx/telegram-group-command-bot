import { describe, expect, test } from "vitest";

import { parseEnv } from "../src/config/env.js";

describe("parseEnv", () => {
  test("applies DeepSeek defaults for generic LLM settings", () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: "telegram-token",
      LLM_API_KEY: "llm-key",
    });

    expect(env.llmApiKey).toBe("llm-key");
    expect(env.llmBaseUrl).toBe("https://api.deepseek.com");
    expect(env.llmReplyModel).toBe("deepseek-chat");
    expect(env.llmSummaryModel).toBe("deepseek-chat");
    expect(env.llmTimeoutMs).toBe(45_000);
    expect(env.llmMaxRetries).toBe(2);
    expect(env.interjectProbability).toBe(0.12);
    expect(env.chatIdleMinutes).toBe(30);
    expect(env.personaFile).toBe("config/persona.md");
    expect(env.messageRetentionDays).toBe(180);
  });

  test("keeps legacy qwen aliases working as fallback", () => {
    const env = parseEnv({
      BOT_TOKEN: "telegram-token",
      QWEN_API_KEY: "legacy-qwen-key",
      QWEN_BASE_URL: "https://legacy.example.com/v1",
      QWEN_REPLY_MODEL: "legacy-reply",
      QWEN_SUMMARY_MODEL: "legacy-summary",
      QWEN_TIMEOUT_MS: "30000",
      QWEN_MAX_RETRIES: "3",
    });

    expect(env.telegramBotToken).toBe("telegram-token");
    expect(env.llmApiKey).toBe("legacy-qwen-key");
    expect(env.llmBaseUrl).toBe("https://legacy.example.com/v1");
    expect(env.llmReplyModel).toBe("legacy-reply");
    expect(env.llmSummaryModel).toBe("legacy-summary");
    expect(env.llmTimeoutMs).toBe(30_000);
    expect(env.llmMaxRetries).toBe(3);
  });

  test("fills omitted legacy provider fields with the old Qwen defaults", () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: "telegram-token",
      QWEN_API_KEY: "legacy-qwen-key"
    });

    expect(env.llmApiKey).toBe("legacy-qwen-key");
    expect(env.llmBaseUrl).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    );
    expect(env.llmReplyModel).toBe("qwen-plus-character");
    expect(env.llmSummaryModel).toBe("qwen3.5-flash");
    expect(env.llmTimeoutMs).toBe(20_000);
    expect(env.llmMaxRetries).toBe(1);
  });

  test("rejects mixed LLM and QWEN provider namespaces", () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: "telegram-token",
        LLM_API_KEY: "llm-key",
        QWEN_BASE_URL: "https://legacy.example.com/v1"
      })
    ).toThrow(/either LLM_\* or QWEN_\*/i);
  });

  test("rejects invalid interjection probability", () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: "telegram-token",
        LLM_API_KEY: "llm-key",
        INTERJECT_PROBABILITY: "1.5",
      }),
    ).toThrow(/INTERJECT_PROBABILITY/i);
  });
});
