import path from 'node:path';
import type { AppEnv } from '../../../src/config/env/index.js';

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
    redditCookiesPath:
      overrides.redditCookiesPath ??
      resolveDefaultCookiesPath(sqlitePath, 'reddit-cookies.txt'),
    instagramCookiesPath:
      overrides.instagramCookiesPath ??
      resolveDefaultCookiesPath(sqlitePath, 'instagram-cookies.txt'),
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
    telegramChatId: -1002155313986,
    telegramAdminId: -1002155313987,
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
