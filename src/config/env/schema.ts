import { z } from 'zod';

import { stringBooleanSchema } from './boolean.js';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY is required'),
  LLM_BASE_URL: z
    .string()
    .url('LLM_BASE_URL must be a valid URL')
    .default('https://api.deepseek.com'),
  LLM_REPLY_MODEL: z.string().min(1).default('deepseek-chat'),
  LLM_PLANNER_MODEL: z.string().min(1).optional(),
  LLM_REPLY_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.6),
  LLM_REPLY_ENABLE_THINKING: stringBooleanSchema.default(false),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  LOG_LLM_TEXT: stringBooleanSchema.default(false),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_COLOR: stringBooleanSchema.default(true),
  SQLITE_PATH: z.string().min(1).default('data/bot.sqlite'),
  EXPLAIN_CONTEXT_LIMIT: z.coerce.number().int().positive().default(16),
  ANSWER_CONTEXT_LIMIT: z.coerce.number().int().positive().default(16),
  SUMMARIZE_CONTEXT_LIMIT: z.coerce.number().int().positive().default(128),
  DECIDE_CONTEXT_LIMIT: z.coerce.number().int().positive().default(64),
  REPLY_MIN_TYPING_MS: z.coerce.number().int().min(0).default(900),
  REPLY_MAX_TYPING_MS: z.coerce.number().int().min(0).default(2200),
  REPLY_TYPING_REFRESH_MS: z.coerce.number().int().min(1000).default(4000),
  LOOKUP_ENABLED: stringBooleanSchema.default(true),
  TAVILY_API_KEY: z.string().min(1).optional(),
  LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(7000),
  LOOKUP_MAX_QUERIES: z.coerce.number().int().min(1).max(3).default(1),
  LOOKUP_MAX_RESULTS: z.coerce.number().int().min(1).max(5).default(3),
  MEDIA_ANALYSIS_ENABLED: stringBooleanSchema.default(false),
  OCR_SPACE_API_KEY: z.string().min(1).optional(),
  READ_CONTEXT_LIMIT: z.coerce.number().int().positive().default(10),
  GLADIA_API_KEY: z.string().min(1).optional(),
  CLOUDFLARE_AI_API_KEY: z.string().min(1).optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  DEPLOY_NOTIFY_CHAT_ID: z.coerce.number().int()
});

export type ParsedRawEnv = z.infer<typeof envSchema>;
