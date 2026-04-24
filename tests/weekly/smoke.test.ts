import { describe, expect, test } from 'vitest';

import { buildWeeklyPreview } from '../../src/app/weekly/index.js';
import {
  canUseBetterSqlite,
  createDatabase,
  createIncomingMessage
} from '../database/support.js';

const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

describeWithSqlite('weekly smoke preview', () => {
  test('builds stats and events without Telegram or LLM clients', () => {
    const db = createDatabase();
    const start = Date.parse('2026-04-23T12:00:00.000Z');

    for (let index = 0; index < 12; index += 1) {
      db.saveIncomingMessage(
        createIncomingMessage({
          chatId: 123,
          messageId: 100 + index,
          fromUserId: index % 2 === 0 ? 42 : 43,
          fromDisplayName: index % 2 === 0 ? 'Tom' : 'Ada',
          text: `burst message ${index}`,
          createdAt: new Date(start + index * 30_000).toISOString()
        })
      );
    }

    const preview = buildWeeklyPreview({
      db,
      chatId: 123,
      now: '2026-04-24T09:00:00.000Z'
    });

    expect(preview.dataset).toContain('WEEK_STATS');
    expect(preview.dataset).toContain('totalHumanMessages=12');
    expect(preview.dataset).toContain('SELECTED_EVENTS');
    expect(preview.dataset).toContain('kinds=burst');
  });
});
