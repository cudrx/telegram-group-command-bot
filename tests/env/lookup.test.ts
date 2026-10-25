import { describe, expect, test } from 'vitest';

import { parseEnv } from './support.js';

describe('parseEnv lookup settings', () => {
  test('reads lookup defaults', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LLM_REPLY_MODEL: 'reply-model',
      TAVILY_API_KEY: 'tvly-key'
    });

    expect(env.lookupProvider).toBe('tavily');
    expect(env.tavilyApiKey).toBe('tvly-key');
    expect(env.lookupTimeoutMs).toBe(7000);
    expect(env.lookupMaxResults).toBe(3);
  });

  test('keeps lookup provider hardcoded to tavily', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TAVILY_API_KEY: 'tvly-key',
      LOOKUP_PROVIDER: 'unsupported'
    });

    expect(env.lookupProvider).toBe('tavily');
  });

  test('reads tavily lookup settings', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LLM_REPLY_MODEL: 'reply-model',
      TAVILY_API_KEY: 'tvly-key',
      LOOKUP_TIMEOUT_MS: '5000',
      LOOKUP_MAX_RESULTS: '4'
    });

    expect(env.lookupProvider).toBe('tavily');
    expect(env.tavilyApiKey).toBe('tvly-key');
    expect(env.lookupTimeoutMs).toBe(5000);
    expect(env.lookupMaxResults).toBe(4);
  });

  test('rejects placeholder tavily api key when it is configured', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TAVILY_API_KEY: 'your-tavily-api-key'
      })
    ).toThrow(/TAVILY_API_KEY contains a placeholder value/i);
  });
});
