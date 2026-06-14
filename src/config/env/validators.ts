import { readFileSync } from 'node:fs';
import { z } from 'zod';

import { STT_PROVIDER, VISION_PROVIDER } from './constants.js';
import type { ParsedRawEnv } from './schema.js';
import type { ChatPolicy, TelegramChatEnv } from './types.js';

const chatFeaturesSchema = z
  .object({
    answer: z.boolean(),
    summarize: z.boolean(),
    decide: z.boolean(),
    translate: z.boolean(),
    read: z.boolean(),
    transcribe: z.boolean(),
    meme: z.boolean(),
    sex: z.boolean(),
    direct_links: z.boolean()
  })
  .strict();

const chatPolicySchema = z
  .object({
    chatId: z.number().int(),
    label: z
      .string()
      .trim()
      .min(1)
      .optional()
      .nullable()
      .transform((value) => value ?? null),
    features: chatFeaturesSchema
  })
  .strict()
  .transform(
    (value): ChatPolicy => ({
      chatId: value.chatId,
      label: value.label,
      features: value.features
    })
  );

const telegramChatConfigSchema = z.array(chatPolicySchema).min(1);

const telegramAccessConfigSchema = z
  .object({
    adminUserId: z.number().int(),
    adminDefaultChatId: z.number().int().nullable().optional(),
    linkUserIds: z.array(z.number().int()).optional()
  })
  .strict()
  .transform((value) => ({
    adminUserId: value.adminUserId,
    adminDefaultChatId: value.adminDefaultChatId ?? null,
    linkUserIds: value.linkUserIds ?? []
  }));

export function validateParsedEnv(parsed: ParsedRawEnv): void {
  if (parsed.REPLY_MIN_TYPING_MS > parsed.REPLY_MAX_TYPING_MS) {
    throw new Error(
      'REPLY_MIN_TYPING_MS must be less than or equal to REPLY_MAX_TYPING_MS.'
    );
  }

  if (parsed.TAVILY_API_KEY && looksLikePlaceholder(parsed.TAVILY_API_KEY)) {
    throw new Error(
      'TAVILY_API_KEY contains a placeholder value. Replace it with a real Tavily API key before starting the bot.'
    );
  }

  validateMediaAnalysisConfig(parsed);
  assertNoPlaceholderSecrets(parsed);
}

export function normalizeTelegramChatEnv(
  parsed: ParsedRawEnv
): TelegramChatEnv {
  const telegramChatPolicies = parseTelegramChatConfig(parsed);
  const accessConfig = parseTelegramAccessConfig(parsed);

  if (
    accessConfig.adminDefaultChatId !== null &&
    !telegramChatPolicies.some(
      (policy) => policy.chatId === accessConfig.adminDefaultChatId
    )
  ) {
    throw new Error(
      'TELEGRAM_ACCESS_CONFIG_PATH adminDefaultChatId must reference a configured chat.'
    );
  }

  return {
    telegramChatPolicies,
    telegramAdminDefaultChatId: accessConfig.adminDefaultChatId,
    telegramAdminId: accessConfig.adminUserId,
    telegramLinkUserIds: accessConfig.linkUserIds
  };
}

function assertNoPlaceholderSecrets(parsed: ParsedRawEnv): void {
  if (looksLikePlaceholder(parsed.LLM_API_KEY)) {
    throw new Error(
      'LLM_API_KEY contains a placeholder value. Replace it with a real provider key before starting the bot.'
    );
  }

  if (looksLikePlaceholder(parsed.TELEGRAM_BOT_TOKEN)) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN contains a placeholder value. Replace it with a real bot token before starting the bot.'
    );
  }
}

function validateMediaAnalysisConfig(parsed: ParsedRawEnv): void {
  if (
    STT_PROVIDER === 'gladia' &&
    parsed.GLADIA_API_KEY &&
    looksLikePlaceholder(parsed.GLADIA_API_KEY)
  ) {
    throw new Error(
      'GLADIA_API_KEY contains a placeholder value. Replace it with a real Gladia API key before starting the bot.'
    );
  }

  if (VISION_PROVIDER === 'cloudflare') {
    if (parsed.CLOUDFLARE_AI_API_KEY && !parsed.CLOUDFLARE_ACCOUNT_ID) {
      throw new Error(
        'CLOUDFLARE_ACCOUNT_ID is required when CLOUDFLARE_AI_API_KEY is set.'
      );
    }

    if (parsed.CLOUDFLARE_ACCOUNT_ID && !parsed.CLOUDFLARE_AI_API_KEY) {
      throw new Error(
        'CLOUDFLARE_AI_API_KEY is required when CLOUDFLARE_ACCOUNT_ID is set.'
      );
    }

    if (
      parsed.CLOUDFLARE_AI_API_KEY &&
      looksLikePlaceholder(parsed.CLOUDFLARE_AI_API_KEY)
    ) {
      throw new Error(
        'CLOUDFLARE_AI_API_KEY contains a placeholder value. Replace it with a real Cloudflare AI API key before starting the bot.'
      );
    }

    if (
      parsed.CLOUDFLARE_ACCOUNT_ID &&
      looksLikePlaceholder(parsed.CLOUDFLARE_ACCOUNT_ID)
    ) {
      throw new Error(
        'CLOUDFLARE_ACCOUNT_ID contains a placeholder value. Replace it with a real Cloudflare account ID before starting the bot.'
      );
    }
  }

  if (
    parsed.OCR_SPACE_API_KEY &&
    looksLikePlaceholder(parsed.OCR_SPACE_API_KEY)
  ) {
    throw new Error(
      'OCR_SPACE_API_KEY contains a placeholder value. Replace it with a real OCR.space API key before starting the bot.'
    );
  }

  if (
    parsed.YANDEX_SPEECHKIT_API_KEY &&
    looksLikePlaceholder(parsed.YANDEX_SPEECHKIT_API_KEY)
  ) {
    throw new Error(
      'YANDEX_SPEECHKIT_API_KEY contains a placeholder value. Replace it with a real Yandex SpeechKit API key before starting the bot.'
    );
  }
}

function looksLikePlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return (
    normalized.length === 0 ||
    normalized.startsWith('your-') ||
    normalized.includes('-here') ||
    normalized.includes('example') ||
    normalized.includes('placeholder') ||
    normalized === 'changeme' ||
    normalized === 'replace-me'
  );
}

function parseTelegramChatConfig(parsed: ParsedRawEnv): ChatPolicy[] {
  const rawChatConfig = loadJsonConfigFile(
    parsed.TELEGRAM_CHAT_CONFIG_PATH,
    'TELEGRAM_CHAT_CONFIG_PATH'
  );

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawChatConfig);
  } catch {
    throw new Error(
      'TELEGRAM_CHAT_CONFIG_PATH must point to a file with valid JSON.'
    );
  }

  const result = telegramChatConfigSchema.safeParse(parsedJson);

  if (!result.success) {
    throw new Error(formatChatConfigIssues(result.error));
  }

  const duplicateChatId = findDuplicateChatId(result.data);

  if (duplicateChatId !== null) {
    throw new Error(
      `TELEGRAM_CHAT_CONFIG_PATH contains duplicate chat id: ${duplicateChatId}.`
    );
  }

  return result.data;
}

function parseTelegramAccessConfig(parsed: ParsedRawEnv): {
  adminUserId: number;
  adminDefaultChatId: number | null;
  linkUserIds: number[];
} {
  const rawAccessConfig = loadJsonConfigFile(
    parsed.TELEGRAM_ACCESS_CONFIG_PATH,
    'TELEGRAM_ACCESS_CONFIG_PATH'
  );

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawAccessConfig);
  } catch {
    throw new Error(
      'TELEGRAM_ACCESS_CONFIG_PATH must point to a file with valid JSON.'
    );
  }

  const result = telegramAccessConfigSchema.safeParse(parsedJson);

  if (!result.success) {
    throw new Error(formatAccessConfigIssues(result.error));
  }

  return result.data;
}

function loadJsonConfigFile(
  configPathValue: string,
  envName: 'TELEGRAM_CHAT_CONFIG_PATH' | 'TELEGRAM_ACCESS_CONFIG_PATH'
): string {
  const configPath = configPathValue.trim();

  try {
    return readFileSync(configPath, 'utf8').trim();
  } catch {
    throw new Error(`${envName} must point to a readable file.`);
  }
}

function findDuplicateChatId(policies: ChatPolicy[]): number | null {
  const seen = new Set<number>();

  for (const policy of policies) {
    if (seen.has(policy.chatId)) {
      return policy.chatId;
    }

    seen.add(policy.chatId);
  }

  return null;
}

function formatChatConfigIssues(error: z.ZodError): string {
  const details = error.issues.map((issue) => {
    const path =
      issue.path.length > 0
        ? issue.path.map((segment) => String(segment)).join('.')
        : 'root';

    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      const location =
        issue.path.at(-1) === 'features'
          ? 'unknown feature key'
          : 'unknown field';

      return `${path}: ${location}: ${issue.keys.join(', ')}`;
    }

    return `${path}: ${issue.message}`;
  });

  return `Invalid TELEGRAM_CHAT_CONFIG_PATH: ${details.join('; ')}`;
}

function formatAccessConfigIssues(error: z.ZodError): string {
  const details = error.issues.map((issue) => {
    const path =
      issue.path.length > 0
        ? issue.path.map((segment) => String(segment)).join('.')
        : 'root';

    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      return `${path}: unknown field: ${issue.keys.join(', ')}`;
    }

    return `${path}: ${issue.message}`;
  });

  return `Invalid TELEGRAM_ACCESS_CONFIG_PATH: ${details.join('; ')}`;
}
