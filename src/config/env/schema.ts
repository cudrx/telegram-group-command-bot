import { z } from 'zod';

import {
  answerActionConfig,
  decideActionConfig,
  llmProviderConfig,
  lookupProviderConfig,
  storageConfig,
  summarizeActionConfig
} from '../runtime/index.js';
import { stringBooleanSchema } from './boolean.js';

const commaSeparatedIntListSchema = z
  .string()
  .optional()
  .transform((value, context) => {
    if (value === undefined || value.trim().length === 0) return [];

    const ids: number[] = [];

    for (const rawPart of value.split(',')) {
      const part = rawPart.trim();
      if (part.length === 0) continue;

      const parsed = Number(part);

      if (!Number.isInteger(parsed)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected comma-separated integer Telegram user ids'
        });
        return z.NEVER;
      }

      ids.push(parsed);
    }

    return ids;
  });

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY is required'),
  LLM_BASE_URL: z
    .string()
    .url('LLM_BASE_URL must be a valid URL')
    .default(llmProviderConfig.genericDefaults.baseUrl),
  LLM_REPLY_MODEL: z
    .string()
    .min(1)
    .default(llmProviderConfig.genericDefaults.replyModel),
  LLM_PLANNER_MODEL: z.string().min(1).optional(),
  LLM_REPLY_TEMPERATURE: z.coerce
    .number()
    .min(0)
    .max(2)
    .default(llmProviderConfig.genericDefaults.replyTemperature),
  LLM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(llmProviderConfig.genericDefaults.timeoutMs),
  LLM_MAX_RETRIES: z.coerce
    .number()
    .int()
    .min(0)
    .max(3)
    .default(llmProviderConfig.genericDefaults.maxRetries),
  LOG_LLM_TEXT: stringBooleanSchema.default(false),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_COLOR: stringBooleanSchema.default(true),
  SQLITE_PATH: z.string().min(1).default(storageConfig.sqlitePath),
  REDDIT_COOKIES_PATH: z.string().min(1).optional(),
  INSTAGRAM_COOKIES_PATH: z.string().min(1).optional(),
  ANSWER_CONTEXT_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(answerActionConfig.contextLimit),
  SUMMARIZE_CONTEXT_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(summarizeActionConfig.contextLimit),
  DECIDE_CONTEXT_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(decideActionConfig.contextLimit),
  REPLY_MIN_TYPING_MS: z.coerce.number().int().min(0).default(900),
  REPLY_MAX_TYPING_MS: z.coerce.number().int().min(0).default(2200),
  REPLY_TYPING_REFRESH_MS: z.coerce.number().int().min(1000).default(4000),
  TAVILY_API_KEY: z.string().min(1).optional(),
  LOOKUP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(lookupProviderConfig.defaults.timeoutMs),
  LOOKUP_MAX_QUERIES: z.coerce
    .number()
    .int()
    .min(1)
    .max(3)
    .default(lookupProviderConfig.defaults.maxQueries),
  LOOKUP_MAX_RESULTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(5)
    .default(lookupProviderConfig.defaults.maxResults),
  OCR_SPACE_API_KEY: z.string().min(1).optional(),
  GLADIA_API_KEY: z.string().min(1).optional(),
  YANDEX_SPEECHKIT_API_KEY: z.string().min(1).optional(),
  CLOUDFLARE_AI_API_KEY: z.string().min(1).optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.coerce.number().int(),
  TELEGRAM_ADMIN_ID: z.coerce.number().int(),
  TELEGRAM_LINK_USER_IDS: commaSeparatedIntListSchema
});

export type ParsedRawEnv = z.infer<typeof envSchema>;
