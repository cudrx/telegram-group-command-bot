import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const stringBooleanSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  switch (value.trim().toLowerCase()) {
    case "true":
    case "1":
    case "yes":
    case "on":
      return true;
    case "false":
    case "0":
    case "no":
    case "off":
      return false;
    default:
      return value;
  }
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_BASE_URL: z
    .string()
    .url("LLM_BASE_URL must be a valid URL")
    .default("https://api.deepseek.com"),
  LLM_REPLY_MODEL: z.string().min(1).default("deepseek-chat"),
  LLM_FAST_REPLY_MODEL: z.string().min(1).optional(),
  LLM_PLANNER_MODEL: z.string().min(1).optional(),
  LLM_REPLY_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.6),
  LLM_REPLY_ENABLE_THINKING: stringBooleanSchema.default(false),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
  LOG_LLM_TEXT: stringBooleanSchema.default(false),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_COLOR: stringBooleanSchema.default(true),
  SQLITE_PATH: z.string().min(1).default("data/bot.sqlite"),
  ASSISTANT_INSTRUCTIONS_FILE: z
    .string()
    .min(1)
    .default("config/assistant-instructions.md"),
  EXPLAIN_CONTEXT_LIMIT: z.coerce.number().int().positive().default(16),
  SUMMARIZE_CONTEXT_LIMIT: z.coerce.number().int().positive().default(128),
  DECIDE_CONTEXT_LIMIT: z.coerce.number().int().positive().default(64),
  REPLY_MIN_TYPING_MS: z.coerce.number().int().min(0).default(900),
  REPLY_MAX_TYPING_MS: z.coerce.number().int().min(0).default(2200),
  REPLY_TYPING_REFRESH_MS: z.coerce.number().int().min(1000).default(4000),
  LOOKUP_ENABLED: stringBooleanSchema.default(false),
  LOOKUP_PROVIDER: z.enum(["tavily"]).default("tavily"),
  TAVILY_API_KEY: z.string().min(1).optional(),
  LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(7000),
  LOOKUP_MAX_QUERIES: z.coerce.number().int().min(1).max(3).default(1),
  LOOKUP_MAX_RESULTS: z.coerce.number().int().min(1).max(5).default(3)
});

type ParsedEnv = {
  nodeEnv: "development" | "test" | "production";
  telegramBotToken: string;
  llmApiKey: string;
  llmBaseUrl: string;
  llmReplyModel: string;
  llmFastReplyModel: string;
  llmPlannerModel: string;
  llmReplyTemperature: number;
  llmReplyEnableThinking: boolean;
  llmTimeoutMs: number;
  llmMaxRetries: number;
  logLlmText: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  logColor: boolean;
  sqlitePath: string;
  assistantInstructionsFile: string;
  explainContextLimit: number;
  summarizeContextLimit: number;
  decideContextLimit: number;
  replyMinTypingMs: number;
  replyMaxTypingMs: number;
  replyTypingRefreshMs: number;
  lookupEnabled: boolean;
  lookupProvider: "tavily";
  tavilyApiKey: string | null;
  lookupTimeoutMs: number;
  lookupMaxQueries: number;
  lookupMaxResults: number;
};

export type AppEnv = ParsedEnv;

export function parseEnv(
  rawEnv: Record<string, string | undefined> = process.env
): ParsedEnv {
  const usesGenericLlmVars =
    rawEnv.LLM_API_KEY !== undefined ||
    rawEnv.LLM_BASE_URL !== undefined ||
    rawEnv.LLM_REPLY_MODEL !== undefined ||
    rawEnv.LLM_FAST_REPLY_MODEL !== undefined ||
    rawEnv.LLM_PLANNER_MODEL !== undefined ||
    rawEnv.LLM_REPLY_TEMPERATURE !== undefined ||
    rawEnv.LLM_REPLY_ENABLE_THINKING !== undefined ||
    rawEnv.LLM_TIMEOUT_MS !== undefined ||
    rawEnv.LLM_MAX_RETRIES !== undefined;
  const usesLegacyQwenVars =
    rawEnv.QWEN_API_KEY !== undefined ||
    rawEnv.QWEN_BASE_URL !== undefined ||
    rawEnv.QWEN_REPLY_MODEL !== undefined ||
    rawEnv.QWEN_REPLY_TEMPERATURE !== undefined ||
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
        LLM_FAST_REPLY_MODEL: rawEnv.LLM_FAST_REPLY_MODEL,
        LLM_PLANNER_MODEL: rawEnv.LLM_PLANNER_MODEL,
        LLM_REPLY_TEMPERATURE: rawEnv.LLM_REPLY_TEMPERATURE,
        LLM_REPLY_ENABLE_THINKING: rawEnv.LLM_REPLY_ENABLE_THINKING,
        LLM_TIMEOUT_MS: rawEnv.LLM_TIMEOUT_MS,
        LLM_MAX_RETRIES: rawEnv.LLM_MAX_RETRIES,
        LOOKUP_ENABLED: rawEnv.LOOKUP_ENABLED,
        LOOKUP_PROVIDER: rawEnv.LOOKUP_PROVIDER,
        TAVILY_API_KEY: rawEnv.TAVILY_API_KEY,
        LOOKUP_TIMEOUT_MS: rawEnv.LOOKUP_TIMEOUT_MS,
        LOOKUP_MAX_QUERIES: rawEnv.LOOKUP_MAX_QUERIES,
        LOOKUP_MAX_RESULTS: rawEnv.LOOKUP_MAX_RESULTS
      }
    : {
        LLM_API_KEY: rawEnv.QWEN_API_KEY,
        LLM_BASE_URL:
          rawEnv.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        LLM_REPLY_MODEL: rawEnv.QWEN_REPLY_MODEL ?? "qwen-plus",
        LLM_FAST_REPLY_MODEL: rawEnv.QWEN_REPLY_MODEL ?? "qwen-plus",
        LLM_PLANNER_MODEL: rawEnv.QWEN_REPLY_MODEL ?? "qwen-plus",
        LLM_REPLY_TEMPERATURE: rawEnv.QWEN_REPLY_TEMPERATURE ?? "0.6",
        LLM_REPLY_ENABLE_THINKING: "false",
        LLM_TIMEOUT_MS: rawEnv.QWEN_TIMEOUT_MS ?? "20000",
        LLM_MAX_RETRIES: rawEnv.QWEN_MAX_RETRIES ?? "1",
        LOOKUP_ENABLED: rawEnv.LOOKUP_ENABLED,
        LOOKUP_PROVIDER: rawEnv.LOOKUP_PROVIDER,
        TAVILY_API_KEY: rawEnv.TAVILY_API_KEY,
        LOOKUP_TIMEOUT_MS: rawEnv.LOOKUP_TIMEOUT_MS,
        LOOKUP_MAX_QUERIES: rawEnv.LOOKUP_MAX_QUERIES,
        LOOKUP_MAX_RESULTS: rawEnv.LOOKUP_MAX_RESULTS
      };

  const parsed = envSchema.parse({
    ...rawEnv,
    TELEGRAM_BOT_TOKEN: rawEnv.TELEGRAM_BOT_TOKEN ?? rawEnv.BOT_TOKEN,
    ...providerEnv
  });

  if (parsed.REPLY_MIN_TYPING_MS > parsed.REPLY_MAX_TYPING_MS) {
    throw new Error(
      "REPLY_MIN_TYPING_MS must be less than or equal to REPLY_MAX_TYPING_MS."
    );
  }

  if (parsed.LOOKUP_ENABLED && parsed.LOOKUP_PROVIDER === "tavily" && !parsed.TAVILY_API_KEY) {
    throw new Error(
      "TAVILY_API_KEY is required when LOOKUP_ENABLED=true and LOOKUP_PROVIDER=tavily."
    );
  }

  if (parsed.LOOKUP_ENABLED && parsed.TAVILY_API_KEY && looksLikePlaceholder(parsed.TAVILY_API_KEY)) {
    throw new Error(
      "TAVILY_API_KEY contains a placeholder value. Replace it with a real Tavily API key before enabling lookup."
    );
  }

  assertNoPlaceholderSecrets(parsed);

  return {
    nodeEnv: parsed.NODE_ENV,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    llmApiKey: parsed.LLM_API_KEY,
    llmBaseUrl: parsed.LLM_BASE_URL,
    llmReplyModel: parsed.LLM_REPLY_MODEL,
    llmFastReplyModel: parsed.LLM_FAST_REPLY_MODEL ?? parsed.LLM_REPLY_MODEL,
    llmPlannerModel: parsed.LLM_PLANNER_MODEL ?? parsed.LLM_REPLY_MODEL,
    llmReplyTemperature: parsed.LLM_REPLY_TEMPERATURE,
    llmReplyEnableThinking: parsed.LLM_REPLY_ENABLE_THINKING,
    llmTimeoutMs: parsed.LLM_TIMEOUT_MS,
    llmMaxRetries: parsed.LLM_MAX_RETRIES,
    logLlmText: parsed.LOG_LLM_TEXT,
    logLevel: parsed.LOG_LEVEL,
    logColor: parsed.LOG_COLOR,
    sqlitePath: parsed.SQLITE_PATH,
    assistantInstructionsFile: parsed.ASSISTANT_INSTRUCTIONS_FILE,
    explainContextLimit: parsed.EXPLAIN_CONTEXT_LIMIT,
    summarizeContextLimit: parsed.SUMMARIZE_CONTEXT_LIMIT,
    decideContextLimit: parsed.DECIDE_CONTEXT_LIMIT,
    replyMinTypingMs: parsed.REPLY_MIN_TYPING_MS,
    replyMaxTypingMs: parsed.REPLY_MAX_TYPING_MS,
    replyTypingRefreshMs: parsed.REPLY_TYPING_REFRESH_MS,
    lookupEnabled: parsed.LOOKUP_ENABLED,
    lookupProvider: parsed.LOOKUP_PROVIDER,
    tavilyApiKey: parsed.TAVILY_API_KEY ?? null,
    lookupTimeoutMs: parsed.LOOKUP_TIMEOUT_MS,
    lookupMaxQueries: parsed.LOOKUP_MAX_QUERIES,
    lookupMaxResults: parsed.LOOKUP_MAX_RESULTS
  };
}

export function getEnv(): AppEnv {
  return parseEnv();
}

function assertNoPlaceholderSecrets(parsed: z.infer<typeof envSchema>): void {
  if (looksLikePlaceholder(parsed.LLM_API_KEY)) {
    throw new Error(
      "LLM_API_KEY contains a placeholder value. Replace it with a real provider key before starting the bot."
    );
  }

  if (looksLikePlaceholder(parsed.TELEGRAM_BOT_TOKEN)) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN contains a placeholder value. Replace it with a real bot token before starting the bot."
    );
  }
}

function looksLikePlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return (
    normalized.length === 0 ||
    normalized.startsWith("your-") ||
    normalized.includes("-here") ||
    normalized.includes("example") ||
    normalized.includes("placeholder") ||
    normalized === "changeme" ||
    normalized === "replace-me"
  );
}
