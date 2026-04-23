import { describe, expect, test } from 'vitest';

import { parseEnv, parseRawEnv } from './support.js';

describe('parseEnv validation', () => {
  test('requires deploy notification chat id', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key'
      })
    ).toThrow(/DEPLOY_NOTIFY_CHAT_ID/);
  });

  test('rejects placeholder secrets', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'your-gemini-api-key'
      })
    ).toThrow(/placeholder/i);
  });

  test('rejects reply typing min values above max values', () => {
    expect(() =>
      parseEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        REPLY_MIN_TYPING_MS: '300',
        REPLY_MAX_TYPING_MS: '200'
      })
    ).toThrow(
      /REPLY_MIN_TYPING_MS must be less than or equal to REPLY_MAX_TYPING_MS\./i
    );
  });
});
