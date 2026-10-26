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

    expect(env.lookupProvider).toBe('deepseek');
    expect(env.deepseekApiKey).toBe('llm-key');
    expect(env.tavilyApiKey).toBe('tvly-key');
    expect(env.lookupTimeoutMs).toBe(7000);
    expect(env.lookupMaxResults).toBe(3);
  });

  test('chooses search from configured credentials rather than an unsupported provider variable', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TAVILY_API_KEY: 'tvly-key',
      LOOKUP_PROVIDER: 'unsupported'
    });

    expect(env.lookupProvider).toBe('deepseek');
  });

  test('reads tavily lookup settings', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LLM_REPLY_MODEL: 'reply-model',
      LLM_BASE_URL: 'https://other-llm.example/v1',
      TAVILY_API_KEY: 'tvly-key',
      LOOKUP_TIMEOUT_MS: '5000',
      LOOKUP_MAX_RESULTS: '4'
    });

    expect(env.lookupProvider).toBe('tavily');
    expect(env.deepseekApiKey).toBeNull();
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

  test('allows a separate DeepSeek search key with another LLM provider', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'other-key',
      LLM_BASE_URL: 'https://other-llm.example/v1',
      DEEPSEEK_API_KEY: 'deepseek-search-key'
    });

    expect(env.lookupProvider).toBe('deepseek');
    expect(env.deepseekApiKey).toBe('deepseek-search-key');
    expect(env.llmApiKey).toBe('other-key');
  });

  test.each([
    'https://api.deepseek.com.example/v1',
    'http://api.deepseek.com'
  ])('does not reuse an LLM key for an unofficial DeepSeek origin: %s', (baseUrl) => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'other-key',
      LLM_BASE_URL: baseUrl
    });

    expect(env.deepseekApiKey).toBeNull();
    expect(env.lookupProvider).toBe('tavily');
  });

  test('rejects a placeholder DeepSeek search key', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        DEEPSEEK_API_KEY: 'your-deepseek-api-key'
      })
    ).toThrow(/DEEPSEEK_API_KEY contains a placeholder/i);
  });
});
