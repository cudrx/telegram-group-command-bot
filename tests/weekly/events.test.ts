import { describe, expect, test } from 'vitest';

import { buildWeeklyCandidates } from '../../src/app/weekly/events.js';
import type { WeeklyMessage } from '../../src/app/weekly/types.js';

function createWeeklyMessage(
  overrides: Partial<WeeklyMessage> & Pick<WeeklyMessage, 'messageId'>
): WeeklyMessage {
  return {
    chatId: 1,
    mediaGroupId: null,
    userId: 10,
    senderDisplayName: 'User',
    text: `message ${overrides.messageId}`,
    createdAt: '2026-04-22T18:10:00.000Z',
    isBot: false,
    replyToMessageId: null,
    mediaSnapshot: null,
    mediaSummary: null,
    ...overrides
  };
}

function minutesAfter(startAt: string, minutes: number): string {
  return new Date(Date.parse(startAt) + minutes * 60_000).toISOString();
}

function createWeeklyMessagesForBurst(input: {
  startAt: string;
  count: number;
  spacingMinutes: number;
  participants: number[];
}): WeeklyMessage[] {
  return Array.from({ length: input.count }, (_, index) =>
    createWeeklyMessage({
      messageId: 101 + index,
      userId:
        input.participants[index % input.participants.length] ??
        input.participants[0] ??
        null,
      createdAt: minutesAfter(input.startAt, index * input.spacingMinutes)
    })
  );
}

function createMediaSnapshot(messageId: number): NonNullable<WeeklyMessage['mediaSnapshot']> {
  return {
    messageId,
    mediaKind: 'photo',
    fileId: `photo-${messageId}`,
    fileUniqueId: `photo-file-${messageId}`,
    mimeType: null,
    fileSize: null,
    durationSeconds: null,
    caption: null
  };
}

function createMixedWeeklyMessages(): WeeklyMessage[] {
  const startAt = '2026-04-23T12:00:00.000Z';

  return [
    createWeeklyMessage({
      messageId: 201,
      userId: 20,
      text: 'what happened here?',
      createdAt: minutesAfter(startAt, 0)
    }),
    createWeeklyMessage({
      messageId: 202,
      userId: 21,
      replyToMessageId: 201,
      text: 'first direct reply',
      createdAt: minutesAfter(startAt, 1)
    }),
    createWeeklyMessage({
      messageId: 203,
      userId: 22,
      replyToMessageId: 201,
      text: 'second direct reply',
      createdAt: minutesAfter(startAt, 2)
    }),
    createWeeklyMessage({
      messageId: 204,
      userId: 23,
      replyToMessageId: 202,
      text: 'nested reply keeps the chain going',
      createdAt: minutesAfter(startAt, 3)
    }),
    createWeeklyMessage({
      messageId: 205,
      userId: 24,
      text: 'nearby context before media',
      createdAt: minutesAfter(startAt, 4)
    }),
    createWeeklyMessage({
      messageId: 206,
      userId: 21,
      text: 'look at this',
      createdAt: minutesAfter(startAt, 5),
      mediaSnapshot: createMediaSnapshot(206),
      mediaSummary: 'a whiteboard full of launch notes'
    }),
    createWeeklyMessage({
      messageId: 207,
      userId: 22,
      replyToMessageId: 206,
      text: 'that diagram is the point',
      createdAt: minutesAfter(startAt, 6)
    }),
    createWeeklyMessage({
      messageId: 208,
      userId: 23,
      text: 'nearby context after media',
      createdAt: minutesAfter(startAt, 7)
    })
  ];
}

describe('weekly event candidates', () => {
  test('detects burst windows and expands to natural boundaries', () => {
    const candidates = buildWeeklyCandidates(
      createWeeklyMessagesForBurst({
        startAt: '2026-04-22T18:10:00.000Z',
        count: 12,
        spacingMinutes: 0.5,
        participants: [10, 11, 12]
      })
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kinds: expect.arrayContaining(['burst']),
          messageIds: expect.arrayContaining([101, 112])
        })
      ])
    );
  });

  test('detects reply hotspots, reply chains, and media moments', () => {
    const candidates = buildWeeklyCandidates(createMixedWeeklyMessages());

    expect(
      candidates.some((candidate) => candidate.kinds.includes('reply_hotspot'))
    ).toBe(true);
    expect(
      candidates.some((candidate) => candidate.kinds.includes('reply_chain'))
    ).toBe(true);
    expect(
      candidates.some((candidate) => candidate.kinds.includes('media_moment'))
    ).toBe(true);
    expect(candidates.map((candidate) => candidate.id)).toEqual(
      [...candidates.map((candidate) => candidate.id)].sort()
    );
    expect(candidates.every((candidate) => candidate.score > 0)).toBe(true);
  });

  test('clusters dense media-heavy stretches into one media moment', () => {
    const startAt = '2026-04-23T14:00:00.000Z';
    const messages = Array.from({ length: 8 }, (_, index) => {
      const messageId = 301 + index;
      const hasMediaSummary = [1, 3, 5].includes(index);

      return createWeeklyMessage({
        messageId,
        userId: 30 + (index % 3),
        createdAt: minutesAfter(startAt, index),
        mediaSnapshot: hasMediaSummary ? createMediaSnapshot(messageId) : null,
        mediaSummary: hasMediaSummary ? `summary ${messageId}` : null
      });
    });

    const mediaMoments = buildWeeklyCandidates(messages).filter((candidate) =>
      candidate.kinds.includes('media_moment')
    );

    expect(mediaMoments).toHaveLength(1);
    expect(mediaMoments[0]).toEqual(
      expect.objectContaining({
        messageIds: [301, 302, 303, 304, 305, 306, 307, 308],
        participantIds: [30, 31, 32]
      })
    );
  });

  test('excludes null participant ids and sorts remaining participants', () => {
    const candidates = buildWeeklyCandidates([
      createWeeklyMessage({
        messageId: 401,
        userId: 12,
        createdAt: minutesAfter('2026-04-23T15:00:00.000Z', 0)
      }),
      createWeeklyMessage({
        messageId: 402,
        userId: null,
        createdAt: minutesAfter('2026-04-23T15:00:00.000Z', 1)
      }),
      createWeeklyMessage({
        messageId: 403,
        userId: 10,
        createdAt: minutesAfter('2026-04-23T15:00:00.000Z', 2)
      }),
      createWeeklyMessage({
        messageId: 404,
        userId: 11,
        createdAt: minutesAfter('2026-04-23T15:00:00.000Z', 3),
        mediaSnapshot: createMediaSnapshot(404),
        mediaSummary: 'a chart with release dates'
      })
    ]);

    const mediaMoment = candidates.find((candidate) =>
      candidate.kinds.includes('media_moment')
    );

    expect(mediaMoment?.participantIds).toEqual([10, 11, 12]);
  });

  test('ignores reply chain links outside the weekly slice', () => {
    const candidates = buildWeeklyCandidates([
      createWeeklyMessage({
        messageId: 501,
        replyToMessageId: 999,
        createdAt: minutesAfter('2026-04-23T16:00:00.000Z', 0)
      }),
      createWeeklyMessage({
        messageId: 502,
        replyToMessageId: 501,
        createdAt: minutesAfter('2026-04-23T16:00:00.000Z', 1)
      }),
      createWeeklyMessage({
        messageId: 503,
        replyToMessageId: 502,
        createdAt: minutesAfter('2026-04-23T16:00:00.000Z', 2)
      })
    ]);

    const replyChain = candidates.find((candidate) =>
      candidate.kinds.includes('reply_chain')
    );

    expect(replyChain?.messageIds).toEqual([501, 502, 503]);
    expect(replyChain?.messageIds).not.toContain(999);
  });
});
