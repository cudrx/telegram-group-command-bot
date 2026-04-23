export function buildProviderEnv(rawEnv: Record<string, string | undefined>) {
  const usesGenericLlmVars =
    rawEnv.LLM_API_KEY !== undefined ||
    rawEnv.LLM_BASE_URL !== undefined ||
    rawEnv.LLM_REPLY_MODEL !== undefined ||
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
      'Invalid provider config: use either LLM_* or QWEN_* variables for the LLM provider, not both.'
    );
  }

  return usesGenericLlmVars
    ? {
        LLM_API_KEY: rawEnv.LLM_API_KEY,
        LLM_BASE_URL: rawEnv.LLM_BASE_URL,
        LLM_REPLY_MODEL: rawEnv.LLM_REPLY_MODEL,
        LLM_PLANNER_MODEL: rawEnv.LLM_PLANNER_MODEL,
        LLM_REPLY_TEMPERATURE: rawEnv.LLM_REPLY_TEMPERATURE,
        LLM_REPLY_ENABLE_THINKING: rawEnv.LLM_REPLY_ENABLE_THINKING,
        LLM_TIMEOUT_MS: rawEnv.LLM_TIMEOUT_MS,
        LLM_MAX_RETRIES: rawEnv.LLM_MAX_RETRIES,
        LOOKUP_ENABLED: rawEnv.LOOKUP_ENABLED,
        TAVILY_API_KEY: rawEnv.TAVILY_API_KEY,
        LOOKUP_TIMEOUT_MS: rawEnv.LOOKUP_TIMEOUT_MS,
        LOOKUP_MAX_QUERIES: rawEnv.LOOKUP_MAX_QUERIES,
        LOOKUP_MAX_RESULTS: rawEnv.LOOKUP_MAX_RESULTS
      }
    : {
        LLM_API_KEY: rawEnv.QWEN_API_KEY,
        LLM_BASE_URL:
          rawEnv.QWEN_BASE_URL ??
          'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        LLM_REPLY_MODEL: rawEnv.QWEN_REPLY_MODEL ?? 'qwen-plus',
        LLM_PLANNER_MODEL: rawEnv.QWEN_REPLY_MODEL ?? 'qwen-plus',
        LLM_REPLY_TEMPERATURE: rawEnv.QWEN_REPLY_TEMPERATURE ?? '0.6',
        LLM_REPLY_ENABLE_THINKING: 'false',
        LLM_TIMEOUT_MS: rawEnv.QWEN_TIMEOUT_MS ?? '20000',
        LLM_MAX_RETRIES: rawEnv.QWEN_MAX_RETRIES ?? '1',
        LOOKUP_ENABLED: rawEnv.LOOKUP_ENABLED,
        TAVILY_API_KEY: rawEnv.TAVILY_API_KEY,
        LOOKUP_TIMEOUT_MS: rawEnv.LOOKUP_TIMEOUT_MS,
        LOOKUP_MAX_QUERIES: rawEnv.LOOKUP_MAX_QUERIES,
        LOOKUP_MAX_RESULTS: rawEnv.LOOKUP_MAX_RESULTS
      };
}
