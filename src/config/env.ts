import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  QWEN_API_KEY: z.string().min(1, "QWEN_API_KEY is required"),
  QWEN_BASE_URL: z
    .string()
    .url("QWEN_BASE_URL must be a valid URL")
    .default("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
  QWEN_REPLY_MODEL: z.string().min(1).default("qwen-plus-character"),
  QWEN_SUMMARY_MODEL: z.string().min(1).default("qwen3.5-flash"),
  QWEN_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  QWEN_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
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

export type AppEnv = ReturnType<typeof parseEnv>;

export function parseEnv(
  rawEnv: Record<string, string | undefined> = process.env
): {
  nodeEnv: "development" | "test" | "production";
  telegramBotToken: string;
  qwenApiKey: string;
  qwenBaseUrl: string;
  qwenReplyModel: string;
  qwenSummaryModel: string;
  qwenTimeoutMs: number;
  qwenMaxRetries: number;
  sqlitePath: string;
  personaFile: string;
  interjectProbability: number;
  interjectCooldownMinutes: number;
  chatIdleMinutes: number;
  minMessagesForSummary: number;
  messageContextLimit: number;
  summarySweepIntervalMs: number;
  messageRetentionDays: number;
} {
  const parsed = envSchema.parse({
    ...rawEnv,
    TELEGRAM_BOT_TOKEN: rawEnv.TELEGRAM_BOT_TOKEN ?? rawEnv.BOT_TOKEN
  });

  return {
    nodeEnv: parsed.NODE_ENV,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    qwenApiKey: parsed.QWEN_API_KEY,
    qwenBaseUrl: parsed.QWEN_BASE_URL,
    qwenReplyModel: parsed.QWEN_REPLY_MODEL,
    qwenSummaryModel: parsed.QWEN_SUMMARY_MODEL,
    qwenTimeoutMs: parsed.QWEN_TIMEOUT_MS,
    qwenMaxRetries: parsed.QWEN_MAX_RETRIES,
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
