import { describe, expect, test } from 'vitest';

import { parseEnv } from './support.js';

describe('parseEnv lookup settings', () => {
  test('defaults planner model to reply model and keeps lookup enabled', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LLM_REPLY_MODEL: 'reply-model',
      TAVILY_API_KEY: 'tvly-key'
    });

    expect(env.llmPlannerModel).toBe('reply-model');
    expect(Object.hasOwn(env, 'llmFastReplyModel')).toBe(false);
    expect(env.llmReplyEnableThinking).toBe(false);
    expect(env.lookupEnabled).toBe(true);
    expect(env.lookupProvider).toBe('tavily');
    expect(env.tavilyApiKey).toBe('tvly-key');
    expect(env.lookupTimeoutMs).toBe(7000);
    expect(env.lookupMaxQueries).toBe(1);
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

  test('reads planner and tavily lookup settings', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LLM_REPLY_MODEL: 'reply-model',
      LLM_PLANNER_MODEL: 'planner-model',
      LLM_REPLY_ENABLE_THINKING: 'true',
      LOOKUP_ENABLED: 'true',
      TAVILY_API_KEY: 'tvly-key',
      LOOKUP_TIMEOUT_MS: '5000',
      LOOKUP_MAX_QUERIES: '2',
      LOOKUP_MAX_RESULTS: '4'
    });

    expect(env.llmPlannerModel).toBe('planner-model');
    expect(Object.hasOwn(env, 'llmFastReplyModel')).toBe(false);
    expect(env.llmReplyEnableThinking).toBe(true);
    expect(env.lookupEnabled).toBe(true);
    expect(env.lookupProvider).toBe('tavily');
    expect(env.tavilyApiKey).toBe('tvly-key');
    expect(env.lookupTimeoutMs).toBe(5000);
    expect(env.lookupMaxQueries).toBe(2);
    expect(env.lookupMaxResults).toBe(4);
  });

  test('requires tavily api key when lookup is enabled', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        LOOKUP_ENABLED: 'true',
        TAVILY_API_KEY: undefined
      })
    ).toThrow(/TAVILY_API_KEY is required when LOOKUP_ENABLED=true/i);
  });

  test('rejects placeholder tavily api key when lookup is enabled', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        LOOKUP_ENABLED: 'true',
        TAVILY_API_KEY: 'your-tavily-api-key'
      })
    ).toThrow(/TAVILY_API_KEY contains a placeholder value/i);
  });
});
