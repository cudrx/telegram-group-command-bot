import path from 'node:path';
import type { AppEnv } from '../../../src/config/env/index.js';
import {
  createTestChatPolicy,
  TEST_CONFIGURED_CHAT_ID,
  TEST_OPERATOR_CHAT_ID
} from '../../helpers/telegram-fixtures.js';

export function createEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  const sqlitePath = overrides.sqlitePath ?? ':memory:';

  return {
    nodeEnv: 'test',
    telegramBotToken: 'telegram-token',
    llmApiKey: 'llm-key',
    llmBaseUrl: 'https://example.com',
    llmReplyModel: 'reply-model',
    llmReplyTemperature: 0.6,
    llmTimeoutMs: 20_000,
    llmMaxRetries: 1,
    logLlmText: false,
    logLevel: 'info',
    logColor: true,
    sqlitePath,
    redditCookieHeaderPath: overrides.redditCookieHeaderPath ?? null,
    redditCookiesPath:
      overrides.redditCookiesPath ??
      resolveDefaultCookiesPath(sqlitePath, 'reddit-cookies.txt'),
    instagramCookiesPath:
      overrides.instagramCookiesPath ??
      resolveDefaultCookiesPath(sqlitePath, 'instagram-cookies.txt'),
    youtubeCookiesPath:
      overrides.youtubeCookiesPath ??
      resolveDefaultCookiesPath(sqlitePath, 'youtube-cookies.txt'),
    answerContextLimit: 50,
    summarizeContextLimit: 200,
    decideContextLimit: 100,
    replyMinTypingMs: 0,
    replyMaxTypingMs: 0,
    replyTypingRefreshMs: 4000,
    llmPlannerModel: 'planner-model',
    lookupProvider: 'tavily',
    tavilyApiKey: null,
    lookupTimeoutMs: 7000,
    lookupMaxQueries: 1,
    lookupMaxResults: 3,
    ocrSpaceApiKey: null,
    sttProvider: 'gladia',
    gladiaApiKey: null,
    yandexSpeechKitApiKey: null,
    visionProvider: 'cloudflare',
    cloudflareAiApiKey: null,
    cloudflareAccountId: null,
    mediaMaxFileBytes: 10_000_000,
    mediaArtifactRetentionDays: 7,
    memeHistoryRetentionDays: 14,
    messageRetentionDays: 7,
    databaseCleanupIntervalHours: 24,
    telegramChatPolicies: [createTestChatPolicy()],
    telegramAdminDefaultChatId: TEST_CONFIGURED_CHAT_ID,
    telegramAdminId: TEST_OPERATOR_CHAT_ID,
    telegramLinkUserIds: [],
    ...overrides
  };
}

function resolveDefaultCookiesPath(
  sqlitePath: string,
  filename: string
): string | null {
  if (sqlitePath === ':memory:') return null;

  return path.join(path.dirname(sqlitePath), filename);
}
