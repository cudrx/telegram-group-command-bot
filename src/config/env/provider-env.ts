import { llmProviderConfig, lookupProviderConfig } from '../runtime/index.js';
import type { ParsedRawEnv } from './schema.js';

export function resolveDeepSeekApiKey(
  env: Pick<ParsedRawEnv, 'DEEPSEEK_API_KEY' | 'LLM_API_KEY' | 'LLM_BASE_URL'>
): string | null {
  if (env.DEEPSEEK_API_KEY) return env.DEEPSEEK_API_KEY;

  const llmOrigin = new URL(env.LLM_BASE_URL).origin;
  const searchOrigin = new URL(lookupProviderConfig.deepseek.endpoint).origin;
  if (llmOrigin !== searchOrigin) return null;

  return env.LLM_API_KEY;
}

export function buildProviderEnv(rawEnv: Record<string, string | undefined>) {
  const usesGenericLlmVars =
    rawEnv.LLM_API_KEY !== undefined ||
    rawEnv.LLM_BASE_URL !== undefined ||
    rawEnv.LLM_REPLY_MODEL !== undefined ||
    rawEnv.LLM_REPLY_TEMPERATURE !== undefined ||
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
      'Invalid provider config: use either LLM_* or QWEN_* variables for the LLM provider, not both.'
    );
  }

  return usesGenericLlmVars
    ? {
        LLM_API_KEY: rawEnv.LLM_API_KEY,
        LLM_BASE_URL: rawEnv.LLM_BASE_URL,
        LLM_REPLY_MODEL: rawEnv.LLM_REPLY_MODEL,
        LLM_REPLY_TEMPERATURE: rawEnv.LLM_REPLY_TEMPERATURE,
        LLM_TIMEOUT_MS: rawEnv.LLM_TIMEOUT_MS,
        LLM_MAX_RETRIES: rawEnv.LLM_MAX_RETRIES,
        TAVILY_API_KEY: rawEnv.TAVILY_API_KEY,
        LOOKUP_TIMEOUT_MS: rawEnv.LOOKUP_TIMEOUT_MS,
        LOOKUP_MAX_RESULTS: rawEnv.LOOKUP_MAX_RESULTS
      }
    : {
        LLM_API_KEY: rawEnv.QWEN_API_KEY,
        LLM_BASE_URL:
          rawEnv.QWEN_BASE_URL ?? llmProviderConfig.legacyQwenDefaults.baseUrl,
        LLM_REPLY_MODEL:
          rawEnv.QWEN_REPLY_MODEL ??
          llmProviderConfig.legacyQwenDefaults.replyModel,
        LLM_REPLY_TEMPERATURE:
          rawEnv.QWEN_REPLY_TEMPERATURE ??
          llmProviderConfig.legacyQwenDefaults.replyTemperature,
        LLM_TIMEOUT_MS:
          rawEnv.QWEN_TIMEOUT_MS ??
          llmProviderConfig.legacyQwenDefaults.timeoutMs,
        LLM_MAX_RETRIES:
          rawEnv.QWEN_MAX_RETRIES ??
          llmProviderConfig.legacyQwenDefaults.maxRetries,
        TAVILY_API_KEY: rawEnv.TAVILY_API_KEY,
        LOOKUP_TIMEOUT_MS: rawEnv.LOOKUP_TIMEOUT_MS,
        LOOKUP_MAX_RESULTS: rawEnv.LOOKUP_MAX_RESULTS
      };
}
