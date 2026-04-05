import { describe, expect, test } from "vitest";

import { parseEnv } from "../src/config/env.js";

describe("parseEnv", () => {
  test("applies defaults for optional settings", () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: "telegram-token",
      QWEN_API_KEY: "qwen-key",
    });

    expect(env.qwenBaseUrl).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    );
    expect(env.qwenReplyModel).toBe("qwen-plus-character");
    expect(env.qwenTimeoutMs).toBe(20_000);
    expect(env.qwenMaxRetries).toBe(1);
    expect(env.interjectProbability).toBe(0.12);
    expect(env.chatIdleMinutes).toBe(30);
    expect(env.personaFile).toBe("config/persona.md");
    expect(env.messageRetentionDays).toBe(180);
  });

  test("rejects invalid interjection probability", () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: "telegram-token",
        QWEN_API_KEY: "qwen-key",
        INTERJECT_PROBABILITY: "1.5",
      }),
    ).toThrow(/INTERJECT_PROBABILITY/i);
  });
});
