import { describe, expect, test } from 'vitest';

import {
  buildWeeklyDataset,
  buildWeeklyPreview
} from '../../src/app/weekly/index.js';
import type {
  WeeklyEventCandidate,
  WeeklyMessage
} from '../../src/app/weekly/types.js';
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

describe('weekly dataset excerpts', () => {
  test('limits large selected events to representative excerpts', () => {
    const messages = Array.from({ length: 30 }, (_value, index) =>
      weeklyMessage({
        messageId: index + 1,
        text: `message ${index + 1}`,
        createdAt: new Date(
          Date.parse('2026-04-23T12:00:00.000Z') + index * 60_000
        ).toISOString(),
        replyToMessageId: index === 15 ? 1 : null,
        mediaSummary: index === 20 ? 'important image' : null,
        mediaSnapshot:
          index === 20
            ? {
                messageId: index + 1,
                mediaKind: 'photo',
                fileId: 'photo-file',
                fileUniqueId: 'photo-unique',
                mimeType: 'image/jpeg',
                fileSize: 100,
                durationSeconds: null,
                caption: null
              }
            : null
      })
    );

    const dataset = buildWeeklyDataset({
      now: '2026-04-24T09:00:00.000Z',
      messages,
      selectedEvents: [
        candidate({
          messageIds: messages.map((message) => message.messageId),
          participantIds: [10, 11]
        })
      ]
    });

    expect(dataset.selectedEvents[0]?.messages).toHaveLength(30);
    expect(dataset.selectedEvents[0]?.excerptMessages).toHaveLength(12);
    expect(dataset.selectedEvents[0]?.omittedMessageCount).toBe(18);
    expect(
      dataset.selectedEvents[0]?.excerptMessages.map(
        (message) => message.messageId
      )
    ).toEqual(expect.arrayContaining([1, 2, 16, 21, 29, 30]));
  });
});

function weeklyMessage(overrides: Partial<WeeklyMessage>): WeeklyMessage {
  return {
    chatId: 1,
    messageId: 1,
    mediaGroupId: null,
    userId: 10,
    senderDisplayName: 'User',
    text: 'message',
    createdAt: '2026-04-23T12:00:00.000Z',
    isBot: false,
    replyToMessageId: null,
    mediaSnapshot: null,
    mediaSummary: null,
    ...overrides
  };
}

function candidate(
  overrides: Partial<WeeklyEventCandidate>
): WeeklyEventCandidate {
  return {
    id: 'event-1',
    kinds: ['burst'],
    startAt: '2026-04-23T12:00:00.000Z',
    endAt: '2026-04-23T12:29:00.000Z',
    messageIds: [1],
    participantIds: [10],
    score: 100,
    reasons: ['dense chat'],
    ...overrides
  };
}
