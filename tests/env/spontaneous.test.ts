import { expect, test } from 'vitest';

import { createTestChatPolicy } from '../helpers/telegram-fixtures.js';
import { parseEnv, writeChatConfigFile } from './support.js';

function parseSpontaneous(spontaneous?: unknown) {
  return parseEnv({
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    LLM_API_KEY: 'llm-key',
    TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([
      {
        ...createTestChatPolicy(),
        ...(spontaneous === undefined ? {} : { spontaneous })
      }
    ])
  }).telegramChatPolicies[0];
}

test('keeps existing chat configs opted out', () => {
  expect(parseSpontaneous()?.spontaneous?.enabled ?? false).toBe(false);
});

test('normalizes enabled per-chat limits', () => {
  expect(parseSpontaneous({ enabled: true })?.spontaneous).toEqual({
    enabled: true,
    probability: 0.03,
    cooldownSeconds: 900,
    minMessages: 20,
    maxAttemptsPerHour: 3
  });
});

test.each([
  { enabled: true, probability: 1.1 },
  { enabled: true, cooldownSeconds: 0 },
  { enabled: true, minMessages: 0 },
  { enabled: true, maxAttemptsPerHour: -1 },
  { enabled: true, unexpected: true }
])('rejects invalid spontaneous configuration: %j', (config) => {
  expect(() => parseSpontaneous(config)).toThrow('spontaneous');
});
