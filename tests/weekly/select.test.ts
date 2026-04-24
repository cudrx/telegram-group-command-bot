import { describe, expect, test } from 'vitest';

import {
  mergeWeeklyCandidates,
  selectWeeklyEvents
} from '../../src/app/weekly/select.js';
import type { WeeklyEventCandidate } from '../../src/app/weekly/types.js';

function candidate(
  overrides: Partial<WeeklyEventCandidate> & Pick<WeeklyEventCandidate, 'id'>
): WeeklyEventCandidate {
  const messageId = Number(overrides.id.replace(/\D/g, '')) || 1;
  const { id, ...rest } = overrides;

  return {
    id,
    kinds: ['burst'],
    startAt: '2026-04-20T10:00:00.000Z',
    endAt: '2026-04-20T10:01:00.000Z',
    messageIds: [messageId],
    participantIds: [messageId],
    score: 10,
    reasons: [`reason ${id}`],
    ...rest
  };
}

function minutesAfter(startAt: string, minutes: number): string {
  return new Date(Date.parse(startAt) + minutes * 60_000).toISOString();
}

describe('weekly event selection', () => {
  test('merges candidates with overlapping message ids', () => {
    const merged = mergeWeeklyCandidates([
      candidate({
        id: 'burst:1-3',
        kinds: ['burst'],
        startAt: '2026-04-20T10:00:00.000Z',
        endAt: '2026-04-20T10:01:00.000Z',
        messageIds: [1, 2, 3],
        participantIds: [10, 11],
        score: 12,
        reasons: ['dense conversation']
      }),
      candidate({
        id: 'reply:3-4',
        kinds: ['reply_hotspot'],
        startAt: '2026-04-20T10:30:00.000Z',
        endAt: '2026-04-20T10:31:00.000Z',
        messageIds: [3, 4],
        participantIds: [11, 12],
        score: 9,
        reasons: ['reply pileup']
      })
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      kinds: ['burst', 'reply_hotspot'],
      startAt: '2026-04-20T10:00:00.000Z',
      endAt: '2026-04-20T10:31:00.000Z',
      messageIds: [1, 2, 3, 4],
      participantIds: [10, 11, 12],
      reasons: ['dense conversation', 'reply pileup']
    });
    expect(merged[0]?.score).toBeGreaterThan(12);
  });

  test('merges candidates with overlapping time windows without shared message ids', () => {
    const merged = mergeWeeklyCandidates([
      candidate({
        id: 'burst:10-11',
        startAt: '2026-04-20T10:00:00.000Z',
        endAt: '2026-04-20T10:05:00.000Z',
        messageIds: [10, 11],
        participantIds: [10],
        score: 8
      }),
      candidate({
        id: 'media:12-13',
        kinds: ['media_moment'],
        startAt: '2026-04-20T10:03:00.000Z',
        endAt: '2026-04-20T10:07:00.000Z',
        messageIds: [12, 13],
        participantIds: [20],
        score: 7
      })
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      kinds: ['burst', 'media_moment'],
      startAt: '2026-04-20T10:00:00.000Z',
      endAt: '2026-04-20T10:07:00.000Z',
      messageIds: [10, 11, 12, 13],
      participantIds: [10, 20]
    });
  });

  test('merges candidates with a gap under five minutes and shared participants', () => {
    const merged = mergeWeeklyCandidates([
      candidate({
        id: 'burst:20-21',
        startAt: '2026-04-20T10:00:00.000Z',
        endAt: '2026-04-20T10:02:00.000Z',
        messageIds: [20, 21],
        participantIds: [10, 11],
        score: 8
      }),
      candidate({
        id: 'reply:22-23',
        kinds: ['reply_chain'],
        startAt: '2026-04-20T10:06:30.000Z',
        endAt: '2026-04-20T10:08:00.000Z',
        messageIds: [22, 23],
        participantIds: [11, 12],
        score: 7
      })
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      kinds: ['burst', 'reply_chain'],
      startAt: '2026-04-20T10:00:00.000Z',
      endAt: '2026-04-20T10:08:00.000Z',
      messageIds: [20, 21, 22, 23],
      participantIds: [10, 11, 12]
    });
  });

  test('selects six to ten events and uses best remaining events to fill past day cap', () => {
    const sameDayEvents = Array.from({ length: 6 }, (_, index) =>
      candidate({
        id: `same-day-${index + 1}`,
        startAt: minutesAfter('2026-04-20T10:00:00.000Z', index * 10),
        endAt: minutesAfter('2026-04-20T10:05:00.000Z', index * 10),
        messageIds: [100 + index],
        participantIds: [10 + index],
        score: 100 - index
      })
    );

    const otherDayEvents = Array.from({ length: 3 }, (_, index) =>
      candidate({
        id: `other-day-${index + 1}`,
        startAt: `2026-04-2${index + 1}T10:00:00.000Z`,
        endAt: `2026-04-2${index + 1}T10:05:00.000Z`,
        messageIds: [200 + index],
        participantIds: [20 + index],
        score: 80 - index
      })
    );

    const selected = selectWeeklyEvents([...sameDayEvents, ...otherDayEvents]);

    expect(selected).toHaveLength(6);
    expect(
      selected.filter((event) => event.startAt.startsWith('2026-04-20'))
    ).toHaveLength(3);
    expect(selected.map((event) => event.id)).toEqual([
      'same-day-1',
      'same-day-2',
      'other-day-1',
      'other-day-2',
      'other-day-3',
      'same-day-3'
    ]);
  });

  test('keeps at most two events per day when enough candidates span days', () => {
    const selected = selectWeeklyEvents(
      Array.from({ length: 18 }, (_, index) => {
        const dayIndex = Math.floor(index / 3);
        const eventIndex = index % 3;

        return candidate({
          id: `day-${dayIndex}-event-${eventIndex}`,
          startAt: minutesAfter(
            `2026-04-${String(20 + dayIndex).padStart(2, '0')}T10:00:00.000Z`,
            eventIndex * 10
          ),
          endAt: minutesAfter(
            `2026-04-${String(20 + dayIndex).padStart(2, '0')}T10:01:00.000Z`,
            eventIndex * 10
          ),
          messageIds: [300 + index],
          participantIds: [300 + index],
          score: 100 - index
        });
      })
    );

    const countsByDay = new Map<string, number>();
    for (const event of selected) {
      const day = event.startAt.slice(0, 10);
      countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1);
    }

    expect(selected).toHaveLength(10);
    expect(Math.max(...countsByDay.values())).toBeLessThanOrEqual(2);
  });

  test('does not select more than ten events', () => {
    const selected = selectWeeklyEvents(
      Array.from({ length: 20 }, (_, index) =>
        candidate({
          id: `event-${index}`,
          startAt: `2026-05-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
          endAt: `2026-05-${String(index + 1).padStart(2, '0')}T10:01:00.000Z`,
          messageIds: [500 + index],
          participantIds: [500 + index],
          score: 100 - index
        })
      )
    );

    expect(selected).toHaveLength(10);
  });

  test('uses deterministic tie breakers for equal scores', () => {
    const selected = selectWeeklyEvents([
      candidate({
        id: 'later',
        startAt: '2026-04-21T10:00:00.000Z',
        endAt: '2026-04-21T10:02:00.000Z',
        messageIds: [3],
        score: 20
      }),
      candidate({
        id: 'earlier',
        startAt: '2026-04-20T10:00:00.000Z',
        endAt: '2026-04-20T10:02:00.000Z',
        messageIds: [2],
        score: 20
      })
    ]);

    expect(selected.map((event) => event.id)).toEqual(['earlier', 'later']);
  });
});
