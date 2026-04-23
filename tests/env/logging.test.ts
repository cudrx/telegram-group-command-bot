import { describe, expect, test } from 'vitest';

import { parseEnv } from './support.js';

describe('parseEnv logging settings', () => {
  test('parses LOG_LLM_TEXT string booleans explicitly', () => {
    const disabled = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LOG_LLM_TEXT: 'false'
    });
    const enabled = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LOG_LLM_TEXT: 'true'
    });

    expect(disabled.logLlmText).toBe(false);
    expect(enabled.logLlmText).toBe(true);
  });

  test('reads log level and color settings', () => {
    const env = parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      LOG_LEVEL: 'debug',
      LOG_COLOR: 'false'
    });

    expect(env.logLevel).toBe('debug');
    expect(env.logColor).toBe(false);
  });
});
