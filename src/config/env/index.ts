import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

import {
  answerActionConfig,
  decideActionConfig,
  summarizeActionConfig
} from '../runtime/index.js';
import {
  DATABASE_CLEANUP_INTERVAL_HOURS,
  LOOKUP_PROVIDER,
  MEDIA_ARTIFACT_RETENTION_DAYS,
  MEDIA_MAX_FILE_BYTES,
  MEME_HISTORY_RETENTION_DAYS,
  MESSAGE_RETENTION_DAYS,
  STT_PROVIDER,
  VISION_PROVIDER
} from './constants.js';
import { buildProviderEnv } from './provider-env.js';
import { envSchema } from './schema.js';
import type { AppEnv, ParsedEnv } from './types.js';
import { normalizeTelegramChatEnv, validateParsedEnv } from './validators.js';

loadDotenv();

export type { AppEnv, ParsedEnv } from './types.js';
export { normalizeTelegramChatEnv } from './validators.js';

export function parseEnv(
  rawEnv: Record<string, string | undefined> = process.env
): ParsedEnv {
  const parsed = envSchema.parse({
    ...rawEnv,
    TELEGRAM_BOT_TOKEN: rawEnv.TELEGRAM_BOT_TOKEN ?? rawEnv.BOT_TOKEN,
    ...buildProviderEnv(rawEnv)
  });

  validateParsedEnv(parsed);
  const telegramChatEnv = normalizeTelegramChatEnv(parsed);

  return {
    nodeEnv: parsed.NODE_ENV,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    llmApiKey: parsed.LLM_API_KEY,
    llmBaseUrl: parsed.LLM_BASE_URL,
    llmReplyModel: parsed.LLM_REPLY_MODEL,
    llmPlannerModel: parsed.LLM_PLANNER_MODEL ?? parsed.LLM_REPLY_MODEL,
    llmReplyTemperature: parsed.LLM_REPLY_TEMPERATURE,
    llmTimeoutMs: parsed.LLM_TIMEOUT_MS,
    llmMaxRetries: parsed.LLM_MAX_RETRIES,
    logLlmText: parsed.LOG_LLM_TEXT,
    logLevel: parsed.LOG_LEVEL,
    logColor: parsed.LOG_COLOR,
    sqlitePath: parsed.SQLITE_PATH,
    redditCookieHeaderPath: parsed.REDDIT_COOKIE_HEADER_PATH ?? null,
    redditCookiesPath:
      parsed.REDDIT_COOKIES_PATH ??
      resolveDefaultCookiesPath(parsed.SQLITE_PATH, 'reddit-cookies.txt'),
    instagramCookiesPath:
      parsed.INSTAGRAM_COOKIES_PATH ??
      resolveDefaultCookiesPath(parsed.SQLITE_PATH, 'instagram-cookies.txt'),
    youtubeCookiesPath:
      parsed.YOUTUBE_COOKIES_PATH ??
      resolveDefaultCookiesPath(parsed.SQLITE_PATH, 'youtube-cookies.txt'),
    answerContextLimit: answerActionConfig.contextLimit,
    summarizeContextLimit: summarizeActionConfig.contextLimit,
    decideContextLimit: decideActionConfig.contextLimit,
    replyMinTypingMs: parsed.REPLY_MIN_TYPING_MS,
    replyMaxTypingMs: parsed.REPLY_MAX_TYPING_MS,
    replyTypingRefreshMs: parsed.REPLY_TYPING_REFRESH_MS,
    lookupProvider: LOOKUP_PROVIDER,
    tavilyApiKey: parsed.TAVILY_API_KEY ?? null,
    lookupTimeoutMs: parsed.LOOKUP_TIMEOUT_MS,
    lookupMaxQueries: parsed.LOOKUP_MAX_QUERIES,
    lookupMaxResults: parsed.LOOKUP_MAX_RESULTS,
    ocrSpaceApiKey: parsed.OCR_SPACE_API_KEY ?? null,
    sttProvider: STT_PROVIDER,
    gladiaApiKey: parsed.GLADIA_API_KEY ?? null,
    visionProvider: VISION_PROVIDER,
    cloudflareAiApiKey: parsed.CLOUDFLARE_AI_API_KEY ?? null,
    cloudflareAccountId: parsed.CLOUDFLARE_ACCOUNT_ID ?? null,
    mediaMaxFileBytes: MEDIA_MAX_FILE_BYTES,
    mediaArtifactRetentionDays: MEDIA_ARTIFACT_RETENTION_DAYS,
    memeHistoryRetentionDays: MEME_HISTORY_RETENTION_DAYS,
    messageRetentionDays: MESSAGE_RETENTION_DAYS,
    databaseCleanupIntervalHours: DATABASE_CLEANUP_INTERVAL_HOURS,
    yandexSpeechKitApiKey: parsed.YANDEX_SPEECHKIT_API_KEY ?? null,
    telegramChatPolicies: telegramChatEnv.telegramChatPolicies,
    telegramAdminDefaultChatId: telegramChatEnv.telegramAdminDefaultChatId,
    telegramAdminId: telegramChatEnv.telegramAdminId,
    telegramLinkUserIds: telegramChatEnv.telegramLinkUserIds
  };
}

export function getEnv(): AppEnv {
  return parseEnv();
}

function resolveDefaultCookiesPath(
  sqlitePath: string,
  filename: string
): string | null {
  if (sqlitePath === ':memory:') return null;

  return path.join(path.dirname(sqlitePath), filename);
}
