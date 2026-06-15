import { describe, expect, test } from 'vitest';

import { getTelegramRetryAfterSeconds } from '../../src/app/telegram-rate-limit.js';

describe('getTelegramRetryAfterSeconds', () => {
  test('reads retry_after from structured Telegram error parameters', () => {
    expect(
      getTelegramRetryAfterSeconds({
        parameters: {
          retry_after: 17
        }
      })
    ).toBe(17);
  });

  test('falls back to parsing retry after from error message text', () => {
    expect(
      getTelegramRetryAfterSeconds(
        new Error(
          "Call to 'sendPhoto' failed! (429: Too Many Requests: retry after 15)"
        )
      )
    ).toBe(15);
  });
});
