import { z } from 'zod';

import { buildProviderEnv } from '../../src/config/env/provider-env.js';

const evalEnvSchema = z.object({
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY is required'),
  LLM_BASE_URL: z
    .string()
    .url('LLM_BASE_URL must be a valid URL')
    .default('https://api.deepseek.com'),
  LLM_REPLY_MODEL: z.string().min(1).default('deepseek-v4-flash'),
  LLM_REPLY_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.6)
});

export type EvalEnv = {
  llmApiKey: string;
  llmBaseUrl: string;
  llmReplyModel: string;
  llmReplyTemperature: number;
};

export function parseEvalEnv(
  rawEnv: Record<string, string | undefined> = process.env
): EvalEnv {
  const parsed = evalEnvSchema.parse({
    ...rawEnv,
    ...buildProviderEnv(rawEnv)
  });

  if (looksLikePlaceholder(parsed.LLM_API_KEY)) {
    throw new Error(
      'LLM_API_KEY contains a placeholder value. Replace it with a real provider key before running intent evals.'
    );
  }

  return {
    llmApiKey: parsed.LLM_API_KEY,
    llmBaseUrl: parsed.LLM_BASE_URL,
    llmReplyModel: parsed.LLM_REPLY_MODEL,
    llmReplyTemperature: parsed.LLM_REPLY_TEMPERATURE
  };
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
