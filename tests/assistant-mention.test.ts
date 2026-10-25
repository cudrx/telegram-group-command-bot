import type { Context } from 'grammy';
import { expect, test } from 'vitest';

import { hasAssistantMention } from '../src/app/assistant-mention.js';
import { normalizeTextMessage } from '../src/transport/telegram/normalize-message.js';

test('preserves Telegram UTF-16 entity offsets after leading whitespace and an emoji', () => {
  const message = normalizeTextMessage({
    message: {
      message_id: 1,
      date: 1,
      chat: { id: 1, type: 'group' },
      from: { id: 42, is_bot: false, first_name: 'Tom' },
      text: '  👋 @FuN_BoT привет',
      entities: [{ type: 'mention', offset: 5, length: 8 }]
    }
  } as Context);
  expect(message).not.toBeNull();
  if (!message) throw new Error('Expected a normalized message');

  expect(hasAssistantMention(message, 'fun_bot')).toBe(true);
});
