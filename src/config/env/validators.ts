import { LOOKUP_PROVIDER, STT_PROVIDER, VISION_PROVIDER } from './constants.js';
import type { ParsedRawEnv } from './schema.js';

export function validateParsedEnv(parsed: ParsedRawEnv): void {
  if (parsed.REPLY_MIN_TYPING_MS > parsed.REPLY_MAX_TYPING_MS) {
    throw new Error(
      'REPLY_MIN_TYPING_MS must be less than or equal to REPLY_MAX_TYPING_MS.'
    );
  }

  if (
    parsed.LOOKUP_ENABLED &&
    LOOKUP_PROVIDER === 'tavily' &&
    !parsed.TAVILY_API_KEY
  ) {
    throw new Error('TAVILY_API_KEY is required when LOOKUP_ENABLED=true.');
  }

  if (
    parsed.LOOKUP_ENABLED &&
    parsed.TAVILY_API_KEY &&
    looksLikePlaceholder(parsed.TAVILY_API_KEY)
  ) {
    throw new Error(
      'TAVILY_API_KEY contains a placeholder value. Replace it with a real Tavily API key before enabling lookup.'
    );
  }

  validateMediaAnalysisConfig(parsed);
  assertNoPlaceholderSecrets(parsed);
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
  if (!parsed.MEDIA_ANALYSIS_ENABLED) {
    return;
  }

  if (STT_PROVIDER === 'gladia') {
    if (!parsed.GLADIA_API_KEY) {
      throw new Error(
        'GLADIA_API_KEY is required when MEDIA_ANALYSIS_ENABLED=true.'
      );
    }

    if (looksLikePlaceholder(parsed.GLADIA_API_KEY)) {
      throw new Error(
        'GLADIA_API_KEY contains a placeholder value. Replace it with a real Gladia API key before enabling media analysis.'
      );
    }
  }

  if (VISION_PROVIDER === 'cloudflare') {
    if (!parsed.CLOUDFLARE_AI_API_KEY) {
      throw new Error(
        'CLOUDFLARE_AI_API_KEY is required when MEDIA_ANALYSIS_ENABLED=true.'
      );
    }

    if (looksLikePlaceholder(parsed.CLOUDFLARE_AI_API_KEY)) {
      throw new Error(
        'CLOUDFLARE_AI_API_KEY contains a placeholder value. Replace it with a real Cloudflare AI API key before enabling media analysis.'
      );
    }

    if (!parsed.CLOUDFLARE_ACCOUNT_ID) {
      throw new Error(
        'CLOUDFLARE_ACCOUNT_ID is required when MEDIA_ANALYSIS_ENABLED=true.'
      );
    }

    if (looksLikePlaceholder(parsed.CLOUDFLARE_ACCOUNT_ID)) {
      throw new Error(
        'CLOUDFLARE_ACCOUNT_ID contains a placeholder value. Replace it with a real Cloudflare account ID before enabling media analysis.'
      );
    }
  }

  if (!parsed.OCR_SPACE_API_KEY) {
    throw new Error(
      'OCR_SPACE_API_KEY is required when MEDIA_ANALYSIS_ENABLED=true.'
    );
  }

  if (looksLikePlaceholder(parsed.OCR_SPACE_API_KEY)) {
    throw new Error(
      'OCR_SPACE_API_KEY contains a placeholder value. Replace it with a real OCR.space API key before enabling media analysis.'
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
