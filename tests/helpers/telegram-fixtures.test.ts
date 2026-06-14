import { describe, expect, test } from 'vitest';

import {
  createTestChatPolicy,
  TEST_CONFIGURED_CHAT_ID,
  TEST_OPERATOR_CHAT_ID
} from './telegram-fixtures.js';

describe('telegram test fixtures', () => {
  test('exports stable default telegram ids and chat policy factory', () => {
    expect(TEST_CONFIGURED_CHAT_ID).toBe(-1009000001111);
    expect(TEST_OPERATOR_CHAT_ID).toBe(900000222);
    expect(createTestChatPolicy()).toEqual({
      chatId: TEST_CONFIGURED_CHAT_ID,
      label: 'default',
      features: {
        answer: true,
        summarize: true,
        decide: true,
        translate: true,
        read: true,
        transcribe: true,
        meme: true,
        sex: true,
        direct_links: true
      }
    });
  });
});
