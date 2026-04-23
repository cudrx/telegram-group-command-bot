import { describe, expect, test } from 'vitest';

import { parseEnv, parseRawEnv } from './support.js';

describe('parseEnv defaults', () => {
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
    expect(env.llmMaxRetries).toBe(1);
    expect(env.logLlmText).toBe(false);
    expect(env.logLevel).toBe('info');
    expect(env.logColor).toBe(true);
    expect(Object.hasOwn(env, 'assistantInstructionsFile')).toBe(false);
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
      ANSWER_CONTEXT_LIMIT: '78',
      SUMMARIZE_CONTEXT_LIMIT: '34',
      DECIDE_CONTEXT_LIMIT: '56'
    });

    expect(env.answerContextLimit).toBe(78);
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
    expect(env.answerContextLimit).toBe(16);
    expect(env.summarizeContextLimit).toBe(128);
    expect(env.decideContextLimit).toBe(64);
  });

  test('ignores retired assistant instructions file env var', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      ASSISTANT_INSTRUCTIONS_FILE: 'custom/assistant-instructions.md'
    });

    expect(Object.hasOwn(env, 'assistantInstructionsFile')).toBe(false);
  });

  test('parses deploy notification chat id', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TAVILY_API_KEY: 'tvly-key',
      DEPLOY_NOTIFY_CHAT_ID: '-1002155313986'
    });

    expect(env.deployNotifyChatId).toBe(-1002155313986);
  });
});
