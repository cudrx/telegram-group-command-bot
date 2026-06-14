import { describe, expect, test } from 'vitest';

import {
  createTestAccessConfig,
  createTestChatPolicy,
  TEST_OPERATOR_CHAT_ID
} from '../helpers/telegram-fixtures.js';
import {
  parseEnv,
  parseRawEnv,
  writeAccessConfigFile,
  writeChatConfigFile
} from './support.js';

describe('parseEnv defaults', () => {
  test('applies v0 reply-only defaults for generic LLM settings', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key'
    });

    expect(env.llmApiKey).toBe('llm-key');
    expect(env.llmBaseUrl).toBe('https://api.deepseek.com');
    expect(env.llmReplyModel).toBe('deepseek-v4-flash');
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

  test('ignores per-intent context limit env overrides', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      ANSWER_CONTEXT_LIMIT: '78',
      SUMMARIZE_CONTEXT_LIMIT: '34',
      DECIDE_CONTEXT_LIMIT: '56'
    });

    expect(env.answerContextLimit).toBe(16);
    expect(env.summarizeContextLimit).toBe(128);
    expect(env.decideContextLimit).toBe(64);
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

  test('parses normalized multichat env fields', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TAVILY_API_KEY: 'tvly-key',
      TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([
        createTestChatPolicy({ label: 'main' })
      ]),
      TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
        createTestAccessConfig()
      ),
      SQLITE_PATH: '/app/data/bot.sqlite'
    });

    expect(env.telegramChatPolicies).toEqual([
      createTestChatPolicy({ label: 'main' })
    ]);
    expect(Object.hasOwn(env, 'telegramChatId')).toBe(false);
    expect(Object.hasOwn(env, 'telegramAdminDefaultChatId')).toBe(false);
    expect(env.telegramAdminId).toBe(TEST_OPERATOR_CHAT_ID);
    expect(env.redditCookiesPath).toBe('/app/data/reddit-cookies.txt');
    expect(env.instagramCookiesPath).toBe('/app/data/instagram-cookies.txt');
    expect(env.youtubeCookiesPath).toBe('/app/data/youtube-cookies.txt');
  });

  test('parses explicit media cookies paths', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TAVILY_API_KEY: 'tvly-key',
      TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([createTestChatPolicy()]),
      TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
        createTestAccessConfig()
      ),
      SQLITE_PATH: '/app/data/bot.sqlite',
      REDDIT_COOKIES_PATH: '/run/secrets/reddit-cookies.txt',
      INSTAGRAM_COOKIES_PATH: '/run/secrets/instagram-cookies.txt',
      YOUTUBE_COOKIES_PATH: '/run/secrets/youtube-cookies.txt'
    });

    expect(env.redditCookiesPath).toBe('/run/secrets/reddit-cookies.txt');
    expect(env.instagramCookiesPath).toBe('/run/secrets/instagram-cookies.txt');
    expect(env.youtubeCookiesPath).toBe('/run/secrets/youtube-cookies.txt');
  });

  test('parses an explicit Reddit cookie header path override', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TAVILY_API_KEY: 'tvly-key',
      TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([createTestChatPolicy()]),
      TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
        createTestAccessConfig()
      ),
      REDDIT_COOKIE_HEADER_PATH: '/run/secrets/reddit-cookie-header.txt'
    });

    expect(env.redditCookieHeaderPath).toBe(
      '/run/secrets/reddit-cookie-header.txt'
    );
  });

  test('does not infer media cookies paths for in-memory sqlite', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TAVILY_API_KEY: 'tvly-key',
      TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([createTestChatPolicy()]),
      TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
        createTestAccessConfig()
      ),
      SQLITE_PATH: ':memory:'
    });

    expect(env.redditCookiesPath).toBeNull();
    expect(env.instagramCookiesPath).toBeNull();
    expect(env.youtubeCookiesPath).toBeNull();
  });

  test('parses telegram link-only user ids', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TAVILY_API_KEY: 'tvly-key',
      TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([createTestChatPolicy()]),
      TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
        createTestAccessConfig({ linkUserIds: [111, 222, 333] })
      )
    });

    expect(env.telegramLinkUserIds).toEqual([111, 222, 333]);
  });

  test('defaults telegram link-only user ids to an empty list', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TAVILY_API_KEY: 'tvly-key',
      TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([createTestChatPolicy()]),
      TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
        createTestAccessConfig()
      )
    });

    expect(env.telegramLinkUserIds).toEqual([]);
  });
});
