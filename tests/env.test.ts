import { describe, expect, test } from "vitest";

import { parseEnv } from "../src/config/env.js";

describe("parseEnv", () => {
  test("applies v0 reply-only defaults for generic LLM settings", () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: "telegram-token",
      LLM_API_KEY: "llm-key"
    });

    expect(env.llmApiKey).toBe("llm-key");
    expect(env.llmBaseUrl).toBe("https://api.deepseek.com");
    expect(env.llmReplyModel).toBe("deepseek-chat");
    expect(env.llmReplyTemperature).toBe(0.6);
    expect(env.llmTimeoutMs).toBe(45_000);
    expect(env.llmMaxRetries).toBe(2);
    expect(env.personaFile).toBe("config/persona.md");
    expect(env.messageContextLimit).toBe(8);
    expect(env.replyToBotLoopCooldownMs).toBe(15_000);
    expect(env.replyToBotMinIntervalMs).toBe(2500);
    expect(env.replyRecentBotMessagesForGuard).toBe(8);
    expect(env.replyMinTypingMs).toBe(900);
    expect(env.replyMaxTypingMs).toBe(2200);
    expect(env.replyTypingRefreshMs).toBe(4000);
  });

  test("keeps legacy qwen aliases working as reply provider fallback", () => {
    const env = parseEnv({
      BOT_TOKEN: "telegram-token",
      QWEN_API_KEY: "legacy-qwen-key",
      QWEN_BASE_URL: "https://legacy.example.com/v1",
      QWEN_REPLY_MODEL: "legacy-reply",
      QWEN_TIMEOUT_MS: "30000",
      QWEN_MAX_RETRIES: "3"
    });

    expect(env.telegramBotToken).toBe("telegram-token");
    expect(env.llmApiKey).toBe("legacy-qwen-key");
    expect(env.llmBaseUrl).toBe("https://legacy.example.com/v1");
    expect(env.llmReplyModel).toBe("legacy-reply");
    expect(env.llmTimeoutMs).toBe(30_000);
    expect(env.llmMaxRetries).toBe(3);
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

  test("rejects placeholder secrets", () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: "telegram-token",
        LLM_API_KEY: "your-gemini-api-key"
      })
    ).toThrow(/placeholder/i);
  });

  test("rejects reply typing min values above max values", () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: "telegram-token",
        LLM_API_KEY: "llm-key",
        REPLY_MIN_TYPING_MS: "300",
        REPLY_MAX_TYPING_MS: "200"
      })
    ).toThrow(/REPLY_MIN_TYPING_MS must be less than or equal to REPLY_MAX_TYPING_MS\./i);
  });
});
