import { config as loadDotenv } from 'dotenv';

import {
  DATABASE_CLEANUP_INTERVAL_HOURS,
  LOOKUP_PROVIDER,
  MEDIA_ARTIFACT_RETENTION_DAYS,
  MEDIA_MAX_FILE_BYTES,
  MESSAGE_RETENTION_DAYS,
  STT_PROVIDER,
  VISION_PROVIDER
} from './constants.js';
import { buildProviderEnv } from './provider-env.js';
import { envSchema } from './schema.js';
import type { AppEnv, ParsedEnv } from './types.js';
import { validateParsedEnv } from './validators.js';

loadDotenv();

export type { AppEnv, ParsedEnv } from './types.js';

export function parseEnv(
  rawEnv: Record<string, string | undefined> = process.env
): ParsedEnv {
  const parsed = envSchema.parse({
    ...rawEnv,
    TELEGRAM_BOT_TOKEN: rawEnv.TELEGRAM_BOT_TOKEN ?? rawEnv.BOT_TOKEN,
    ...buildProviderEnv(rawEnv)
  });

  validateParsedEnv(parsed);

  return {
    nodeEnv: parsed.NODE_ENV,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    llmApiKey: parsed.LLM_API_KEY,
    llmBaseUrl: parsed.LLM_BASE_URL,
    llmReplyModel: parsed.LLM_REPLY_MODEL,
    llmPlannerModel: parsed.LLM_PLANNER_MODEL ?? parsed.LLM_REPLY_MODEL,
    llmReplyTemperature: parsed.LLM_REPLY_TEMPERATURE,
    llmReplyEnableThinking: parsed.LLM_REPLY_ENABLE_THINKING,
    llmTimeoutMs: parsed.LLM_TIMEOUT_MS,
    llmMaxRetries: parsed.LLM_MAX_RETRIES,
    logLlmText: parsed.LOG_LLM_TEXT,
    logLevel: parsed.LOG_LEVEL,
    logColor: parsed.LOG_COLOR,
    sqlitePath: parsed.SQLITE_PATH,
    answerContextLimit: parsed.ANSWER_CONTEXT_LIMIT,
    summarizeContextLimit: parsed.SUMMARIZE_CONTEXT_LIMIT,
    decideContextLimit: parsed.DECIDE_CONTEXT_LIMIT,
    replyMinTypingMs: parsed.REPLY_MIN_TYPING_MS,
    replyMaxTypingMs: parsed.REPLY_MAX_TYPING_MS,
    replyTypingRefreshMs: parsed.REPLY_TYPING_REFRESH_MS,
    lookupEnabled: parsed.LOOKUP_ENABLED,
    lookupProvider: LOOKUP_PROVIDER,
    tavilyApiKey: parsed.TAVILY_API_KEY ?? null,
    lookupTimeoutMs: parsed.LOOKUP_TIMEOUT_MS,
    lookupMaxQueries: parsed.LOOKUP_MAX_QUERIES,
    lookupMaxResults: parsed.LOOKUP_MAX_RESULTS,
    mediaAnalysisEnabled: parsed.MEDIA_ANALYSIS_ENABLED,
    ocrSpaceApiKey: parsed.OCR_SPACE_API_KEY ?? null,
    readContextLimit: parsed.READ_CONTEXT_LIMIT,
    sttProvider: STT_PROVIDER,
    gladiaApiKey: parsed.GLADIA_API_KEY ?? null,
    visionProvider: VISION_PROVIDER,
    cloudflareAiApiKey: parsed.CLOUDFLARE_AI_API_KEY ?? null,
    cloudflareAccountId: parsed.CLOUDFLARE_ACCOUNT_ID ?? null,
    mediaMaxFileBytes: MEDIA_MAX_FILE_BYTES,
    mediaArtifactRetentionDays: MEDIA_ARTIFACT_RETENTION_DAYS,
    messageRetentionDays: MESSAGE_RETENTION_DAYS,
    databaseCleanupIntervalHours: DATABASE_CLEANUP_INTERVAL_HOURS,
    deployNotifyChatId: parsed.DEPLOY_NOTIFY_CHAT_ID
  };
}

export function getEnv(): AppEnv {
  return parseEnv();
}
