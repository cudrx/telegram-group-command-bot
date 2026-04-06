import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_BASE_URL: z
    .string()
    .url("LLM_BASE_URL must be a valid URL")
    .default("https://api.deepseek.com"),
  LLM_REPLY_MODEL: z.string().min(1).default("deepseek-chat"),
  LLM_SUMMARY_MODEL: z.string().min(1).default("deepseek-chat"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
  SQLITE_PATH: z.string().min(1).default("data/bot.sqlite"),
  PERSONA_FILE: z.string().min(1).default("config/persona.md"),
  INTERJECT_PROBABILITY: z.coerce.number().min(0).max(1).default(0.12),
  INTERJECT_COOLDOWN_MINUTES: z.coerce.number().positive().default(30),
  CHAT_IDLE_MINUTES: z.coerce.number().positive().default(30),
  MIN_MESSAGES_FOR_SUMMARY: z.coerce.number().int().positive().default(10),
  MESSAGE_CONTEXT_LIMIT: z.coerce.number().int().positive().default(16),
  SUMMARY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  MESSAGE_RETENTION_DAYS: z.coerce.number().int().min(0).default(180)
});

type ParsedEnv = {
  nodeEnv: "development" | "test" | "production";
  telegramBotToken: string;
  llmApiKey: string;
  llmBaseUrl: string;
  llmReplyModel: string;
  llmSummaryModel: string;
  llmTimeoutMs: number;
  llmMaxRetries: number;
  sqlitePath: string;
  personaFile: string;
  interjectProbability: number;
  interjectCooldownMinutes: number;
  chatIdleMinutes: number;
  minMessagesForSummary: number;
  messageContextLimit: number;
  summarySweepIntervalMs: number;
  messageRetentionDays: number;
};

export type AppEnv = ParsedEnv;

export function parseEnv(
  rawEnv: Record<string, string | undefined> = process.env
): ParsedEnv {
  const usesGenericLlmVars =
    rawEnv.LLM_API_KEY !== undefined ||
    rawEnv.LLM_BASE_URL !== undefined ||
    rawEnv.LLM_REPLY_MODEL !== undefined ||
    rawEnv.LLM_SUMMARY_MODEL !== undefined ||
    rawEnv.LLM_TIMEOUT_MS !== undefined ||
    rawEnv.LLM_MAX_RETRIES !== undefined;
  const usesLegacyQwenVars =
    rawEnv.QWEN_API_KEY !== undefined ||
    rawEnv.QWEN_BASE_URL !== undefined ||
    rawEnv.QWEN_REPLY_MODEL !== undefined ||
    rawEnv.QWEN_SUMMARY_MODEL !== undefined ||
    rawEnv.QWEN_TIMEOUT_MS !== undefined ||
    rawEnv.QWEN_MAX_RETRIES !== undefined;

  if (usesGenericLlmVars && usesLegacyQwenVars) {
    throw new Error(
      "Invalid provider config: use either LLM_* or QWEN_* variables for the LLM provider, not both."
    );
  }

  const providerEnv = usesGenericLlmVars
    ? {
        LLM_API_KEY: rawEnv.LLM_API_KEY,
        LLM_BASE_URL: rawEnv.LLM_BASE_URL,
        LLM_REPLY_MODEL: rawEnv.LLM_REPLY_MODEL,
        LLM_SUMMARY_MODEL: rawEnv.LLM_SUMMARY_MODEL,
        LLM_TIMEOUT_MS: rawEnv.LLM_TIMEOUT_MS,
        LLM_MAX_RETRIES: rawEnv.LLM_MAX_RETRIES
      }
    : {
        LLM_API_KEY: rawEnv.QWEN_API_KEY,
        LLM_BASE_URL:
          rawEnv.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        LLM_REPLY_MODEL: rawEnv.QWEN_REPLY_MODEL ?? "qwen-plus-character",
        LLM_SUMMARY_MODEL: rawEnv.QWEN_SUMMARY_MODEL ?? "qwen3.5-flash",
        LLM_TIMEOUT_MS: rawEnv.QWEN_TIMEOUT_MS ?? "20000",
        LLM_MAX_RETRIES: rawEnv.QWEN_MAX_RETRIES ?? "1"
      };

  const parsed = envSchema.parse({
    ...rawEnv,
    TELEGRAM_BOT_TOKEN: rawEnv.TELEGRAM_BOT_TOKEN ?? rawEnv.BOT_TOKEN,
    ...providerEnv
  });

  return {
    nodeEnv: parsed.NODE_ENV,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    llmApiKey: parsed.LLM_API_KEY,
    llmBaseUrl: parsed.LLM_BASE_URL,
    llmReplyModel: parsed.LLM_REPLY_MODEL,
    llmSummaryModel: parsed.LLM_SUMMARY_MODEL,
    llmTimeoutMs: parsed.LLM_TIMEOUT_MS,
    llmMaxRetries: parsed.LLM_MAX_RETRIES,
    sqlitePath: parsed.SQLITE_PATH,
    personaFile: parsed.PERSONA_FILE,
    interjectProbability: parsed.INTERJECT_PROBABILITY,
    interjectCooldownMinutes: parsed.INTERJECT_COOLDOWN_MINUTES,
    chatIdleMinutes: parsed.CHAT_IDLE_MINUTES,
    minMessagesForSummary: parsed.MIN_MESSAGES_FOR_SUMMARY,
    messageContextLimit: parsed.MESSAGE_CONTEXT_LIMIT,
    summarySweepIntervalMs: parsed.SUMMARY_SWEEP_INTERVAL_MS,
    messageRetentionDays: parsed.MESSAGE_RETENTION_DAYS
  };
}

export function getEnv(): AppEnv {
  return parseEnv();
}
