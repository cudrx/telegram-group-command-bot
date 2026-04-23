import { describe, expect, test } from 'vitest';

import { parseEnv } from './support.js';

describe('parseEnv media settings', () => {
  test('applies media analysis defaults when disabled', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key'
    });

    expect(env.mediaAnalysisEnabled).toBe(false);
    expect(env.ocrSpaceApiKey).toBe(null);
    expect(env.readContextLimit).toBe(10);
    expect(env.sttProvider).toBe('gladia');
    expect(env.gladiaApiKey).toBe(null);
    expect(env.visionProvider).toBe('cloudflare');
    expect(env.cloudflareAiApiKey).toBe(null);
    expect(env.cloudflareAccountId).toBe(null);
    expect(env.mediaMaxFileBytes).toBe(10_000_000);
    expect(env.mediaArtifactRetentionDays).toBe(7);
    expect(env.messageRetentionDays).toBe(7);
    expect(env.databaseCleanupIntervalHours).toBe(24);
  });

  test('keeps media provider and retention defaults hardcoded', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      MEDIA_ANALYSIS_ENABLED: 'true',
      OCR_SPACE_API_KEY: 'ocr-key',
      READ_CONTEXT_LIMIT: '12',
      STT_PROVIDER: 'unsupported',
      GLADIA_API_KEY: 'gladia-key',
      VISION_PROVIDER: 'unsupported',
      CLOUDFLARE_AI_API_KEY: 'cf-key',
      CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      MEDIA_MAX_FILE_BYTES: '9000000',
      MEDIA_ARTIFACT_RETENTION_DAYS: '5',
      MESSAGE_RETENTION_DAYS: '3',
      DATABASE_CLEANUP_INTERVAL_HOURS: '12'
    });

    expect(env.mediaAnalysisEnabled).toBe(true);
    expect(env.ocrSpaceApiKey).toBe('ocr-key');
    expect(env.readContextLimit).toBe(12);
    expect(env.sttProvider).toBe('gladia');
    expect(env.gladiaApiKey).toBe('gladia-key');
    expect(env.visionProvider).toBe('cloudflare');
    expect(env.cloudflareAiApiKey).toBe('cf-key');
    expect(env.cloudflareAccountId).toBe('cf-account');
    expect(env.mediaMaxFileBytes).toBe(10_000_000);
    expect(env.mediaArtifactRetentionDays).toBe(7);
    expect(env.messageRetentionDays).toBe(7);
    expect(env.databaseCleanupIntervalHours).toBe(24);
  });

  test('requires provider keys when media analysis is enabled', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        MEDIA_ANALYSIS_ENABLED: 'true',
        OCR_SPACE_API_KEY: 'ocr-key'
      })
    ).toThrow(/GLADIA_API_KEY is required when MEDIA_ANALYSIS_ENABLED=true/i);

    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        MEDIA_ANALYSIS_ENABLED: 'true',
        OCR_SPACE_API_KEY: 'ocr-key',
        GLADIA_API_KEY: 'gladia-key'
      })
    ).toThrow(
      /CLOUDFLARE_AI_API_KEY is required when MEDIA_ANALYSIS_ENABLED=true/i
    );
  });

  test('requires OCR.space key when media analysis is enabled', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        MEDIA_ANALYSIS_ENABLED: 'true',
        GLADIA_API_KEY: 'gladia-key',
        CLOUDFLARE_AI_API_KEY: 'cf-key',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account'
      })
    ).toThrow(/OCR_SPACE_API_KEY is required/i);
  });

  test('rejects placeholder provider keys when media analysis is enabled', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        MEDIA_ANALYSIS_ENABLED: 'true',
        OCR_SPACE_API_KEY: 'ocr-key',
        GLADIA_API_KEY: 'your-gladia-api-key',
        CLOUDFLARE_AI_API_KEY: 'cf-key',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account'
      })
    ).toThrow(/GLADIA_API_KEY contains a placeholder value/i);

    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        MEDIA_ANALYSIS_ENABLED: 'true',
        OCR_SPACE_API_KEY: 'your-ocr-space-api-key',
        GLADIA_API_KEY: 'gladia-key',
        CLOUDFLARE_AI_API_KEY: 'cf-key',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account'
      })
    ).toThrow(/OCR_SPACE_API_KEY contains a placeholder value/i);

    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        MEDIA_ANALYSIS_ENABLED: 'true',
        OCR_SPACE_API_KEY: 'ocr-key',
        GLADIA_API_KEY: 'gladia-key',
        CLOUDFLARE_AI_API_KEY: 'your-cloudflare-ai-api-key',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account'
      })
    ).toThrow(/CLOUDFLARE_AI_API_KEY contains a placeholder value/i);

    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        MEDIA_ANALYSIS_ENABLED: 'true',
        OCR_SPACE_API_KEY: 'ocr-key',
        GLADIA_API_KEY: 'gladia-key',
        CLOUDFLARE_AI_API_KEY: 'cf-key',
        CLOUDFLARE_ACCOUNT_ID: 'your-cloudflare-account-id'
      })
    ).toThrow(/CLOUDFLARE_ACCOUNT_ID contains a placeholder value/i);
  });
});
