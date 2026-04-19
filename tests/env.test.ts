import { describe, expect, test } from 'vitest';

import { parseEnv as parseRawEnv } from '../src/config/env.js';

function parseEnv(rawEnv: Record<string, string | undefined>) {
  return parseRawEnv({
    DEPLOY_NOTIFY_CHAT_ID: '-1002155313986',
    ...rawEnv
  });
}

describe('parseEnv', () => {
  test('applies v0 reply-only defaults for generic LLM settings', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key'
    });

    expect(env.llmApiKey).toBe('llm-key');
    expect(env.llmBaseUrl).toBe('https://api.deepseek.com');
    expect(env.llmReplyModel).toBe('deepseek-chat');
    expect(env.llmReplyTemperature).toBe(0.6);
    expect(env.llmTimeoutMs).toBe(45_000);
    expect(env.llmMaxRetries).toBe(2);
    expect(env.logLlmText).toBe(false);
    expect(env.logLevel).toBe('info');
    expect(env.logColor).toBe(true);
    expect(env.assistantInstructionsFile).toBe('llm/assistant/base.md');
    expect(env.explainContextLimit).toBe(16);
    expect(env.summarizeContextLimit).toBe(128);
    expect(env.decideContextLimit).toBe(64);
    expect(env.replyMinTypingMs).toBe(900);
    expect(env.replyMaxTypingMs).toBe(2200);
    expect(env.replyTypingRefreshMs).toBe(4000);
  });

  test('reads per-intent context limit overrides', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      EXPLAIN_CONTEXT_LIMIT: '12',
      SUMMARIZE_CONTEXT_LIMIT: '34',
      DECIDE_CONTEXT_LIMIT: '56'
    });

    expect(env.explainContextLimit).toBe(12);
    expect(env.summarizeContextLimit).toBe(34);
    expect(env.decideContextLimit).toBe(56);
  });

  test('ignores legacy MESSAGE_CONTEXT_LIMIT', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      MESSAGE_CONTEXT_LIMIT: '999'
    });

    expect(Object.hasOwn(env, 'messageContextLimit')).toBe(false);
    expect(env.explainContextLimit).toBe(16);
    expect(env.summarizeContextLimit).toBe(128);
    expect(env.decideContextLimit).toBe(64);
  });

  test('reads assistant instructions file from the new env var', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      ASSISTANT_INSTRUCTIONS_FILE: 'custom/assistant-instructions.md'
    });

    expect(env.assistantInstructionsFile).toBe(
      'custom/assistant-instructions.md'
    );
  });

  test('defaults planner model to reply model and keeps lookup disabled', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LLM_REPLY_MODEL: 'reply-model'
    });

    expect(env.llmPlannerModel).toBe('reply-model');
    expect(env.llmFastReplyModel).toBe('reply-model');
    expect(env.llmReplyEnableThinking).toBe(false);
    expect(env.lookupEnabled).toBe(false);
    expect(env.lookupProvider).toBe('tavily');
    expect(env.tavilyApiKey).toBe(null);
    expect(env.lookupTimeoutMs).toBe(7000);
    expect(env.lookupMaxQueries).toBe(1);
    expect(env.lookupMaxResults).toBe(3);
  });

  test('reads planner and tavily lookup settings', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LLM_REPLY_MODEL: 'reply-model',
      LLM_FAST_REPLY_MODEL: 'fast-reply-model',
      LLM_PLANNER_MODEL: 'planner-model',
      LLM_REPLY_ENABLE_THINKING: 'true',
      LOOKUP_ENABLED: 'true',
      LOOKUP_PROVIDER: 'tavily',
      TAVILY_API_KEY: 'tvly-key',
      LOOKUP_TIMEOUT_MS: '5000',
      LOOKUP_MAX_QUERIES: '2',
      LOOKUP_MAX_RESULTS: '4'
    });

    expect(env.llmPlannerModel).toBe('planner-model');
    expect(env.llmFastReplyModel).toBe('fast-reply-model');
    expect(env.llmReplyEnableThinking).toBe(true);
    expect(env.lookupEnabled).toBe(true);
    expect(env.lookupProvider).toBe('tavily');
    expect(env.tavilyApiKey).toBe('tvly-key');
    expect(env.lookupTimeoutMs).toBe(5000);
    expect(env.lookupMaxQueries).toBe(2);
    expect(env.lookupMaxResults).toBe(4);
  });

  test('parses deploy notification chat id', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      DEPLOY_NOTIFY_CHAT_ID: '-1002155313986'
    });

    expect(env.deployNotifyChatId).toBe(-1002155313986);
  });

  test('requires deploy notification chat id', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key'
      })
    ).toThrow(/DEPLOY_NOTIFY_CHAT_ID/);
  });

  test('requires tavily api key when lookup is enabled', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        LOOKUP_ENABLED: 'true',
        LOOKUP_PROVIDER: 'tavily'
      })
    ).toThrow(/TAVILY_API_KEY is required when LOOKUP_ENABLED=true/i);
  });

  test('rejects placeholder tavily api key when lookup is enabled', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        LOOKUP_ENABLED: 'true',
        LOOKUP_PROVIDER: 'tavily',
        TAVILY_API_KEY: 'your-tavily-api-key'
      })
    ).toThrow(/TAVILY_API_KEY contains a placeholder value/i);
  });

  test('parses LOG_LLM_TEXT string booleans explicitly', () => {
    const disabled = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LOG_LLM_TEXT: 'false'
    });
    const enabled = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LOG_LLM_TEXT: 'true'
    });

    expect(disabled.logLlmText).toBe(false);
    expect(enabled.logLlmText).toBe(true);
  });

  test('reads log level and color settings', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LOG_LEVEL: 'debug',
      LOG_COLOR: 'false'
    });

    expect(env.logLevel).toBe('debug');
    expect(env.logColor).toBe(false);
  });

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
    expect(env.llmFastReplyModel).toBe('legacy-reply');
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

  test('rejects placeholder secrets', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'your-gemini-api-key'
      })
    ).toThrow(/placeholder/i);
  });

  test('rejects reply typing min values above max values', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        REPLY_MIN_TYPING_MS: '300',
        REPLY_MAX_TYPING_MS: '200'
      })
    ).toThrow(
      /REPLY_MIN_TYPING_MS must be less than or equal to REPLY_MAX_TYPING_MS\./i
    );
  });
});
