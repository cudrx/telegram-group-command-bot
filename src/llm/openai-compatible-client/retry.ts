import type { LlmClientConfig } from './types.js';

export async function withRetry<T>(
  operation: () => Promise<T>,
  config: LlmClientConfig
): Promise<{
  value: T;
  attemptCount: number;
}> {
  let attemptCount = 0;

  while (true) {
    attemptCount += 1;

    try {
      return {
        value: await operation(),
        attemptCount
      };
    } catch (error) {
      if (attemptCount > config.maxRetries || !isRetriableError(error)) {
        throw enrichProviderError(error, config);
      }
    }
  }
}

function isRetriableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as {
    status?: unknown;
    code?: unknown;
    name?: unknown;
  };
  const status =
    typeof maybeError.status === 'number' ? maybeError.status : null;
  const code = typeof maybeError.code === 'string' ? maybeError.code : null;
  const name = typeof maybeError.name === 'string' ? maybeError.name : null;

  if (status !== null && status >= 500) {
    return true;
  }

  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') {
    return true;
  }

  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  );
}

function enrichProviderError(
  error: unknown,
  config: Pick<LlmClientConfig, 'apiKey' | 'baseUrl'>
): unknown {
  if (!error || typeof error !== 'object') {
    return error;
  }

  const maybeError = error as Error & { status?: unknown };
  const status =
    typeof maybeError.status === 'number' ? maybeError.status : undefined;
  const message =
    typeof maybeError.message === 'string' ? maybeError.message : '';

  if (status !== 400) {
    return error;
  }

  const hints: string[] = [];

  if (isGeminiBaseUrl(config.baseUrl)) {
    hints.push(
      'Gemini OpenAI-compatible endpoint detected. Verify LLM_BASE_URL points to https://generativelanguage.googleapis.com/v1beta/openai/ and that LLM_API_KEY is a real Gemini API key, not a placeholder.'
    );
  }

  if (looksLikePlaceholderApiKey(config.apiKey)) {
    hints.push(
      'LLM_API_KEY still looks like a placeholder value and should be replaced before runtime.'
    );
  }

  if (hints.length === 0) {
    return error;
  }

  const enriched = new Error(`${message} ${hints.join(' ')}`.trim(), {
    cause: error
  });

  enriched.name = maybeError.name;

  return Object.assign(enriched, {
    status
  });
}

function isGeminiBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes('generativelanguage.googleapis.com');
}

function looksLikePlaceholderApiKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return normalized.startsWith('your-') || normalized.includes('placeholder');
}
