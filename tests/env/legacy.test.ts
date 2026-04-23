import { describe, expect, test } from 'vitest';

import { parseEnv } from './support.js';

describe('parseEnv legacy aliases', () => {
  test('keeps legacy qwen aliases working as reply provider fallback', () => {
    const env = parseEnv({
      BOT_TOKEN: 'telegram-token',
      QWEN_API_KEY: 'legacy-qwen-key',
      QWEN_BASE_URL: 'https://legacy.example.com/v1',
      QWEN_REPLY_MODEL: 'legacy-reply',
      QWEN_TIMEOUT_MS: '30000',
      QWEN_MAX_RETRIES: '3'
    });

    expect(env.telegramBotToken).toBe('telegram-token');
    expect(env.llmApiKey).toBe('legacy-qwen-key');
    expect(env.llmBaseUrl).toBe('https://legacy.example.com/v1');
    expect(env.llmReplyModel).toBe('legacy-reply');
    expect(Object.hasOwn(env, 'llmFastReplyModel')).toBe(false);
    expect(env.llmReplyEnableThinking).toBe(false);
    expect(env.llmTimeoutMs).toBe(30_000);
    expect(env.llmMaxRetries).toBe(3);
  });

  test('uses a neutral legacy qwen reply model fallback', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      QWEN_API_KEY: 'legacy-qwen-key'
    });

    expect(env.llmReplyModel).toBe('qwen-plus');
  });

  test('rejects mixed LLM and QWEN provider namespaces', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        QWEN_BASE_URL: 'https://legacy.example.com/v1'
      })
    ).toThrow(/either LLM_\* or QWEN_\*/i);
  });
});
