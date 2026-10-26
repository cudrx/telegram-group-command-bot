import { describe, expect, test } from 'vitest';

import {
  compareProductionPrompts,
  getReplyAncestorIds,
  transformExperimentMessages
} from '../scripts/evaluate-conversation/context.js';
import { createFixture } from '../scripts/intent-eval-fixtures/factory.js';
import { buildAnswerMessages } from '../src/llm/openai-compatible-client/answer.js';

const fixture = createFixture({
  id: 'experiment-control',
  intent: 'answer',
  targetDisplayName: 'Алиса',
  rows: [
    ['2026-10-26T10:00:00Z', 'Бот', 'Устаревшее мнение.'],
    ['2026-10-26T10:00:01Z', 'Алиса', 'Новая тема.'],
    ['2026-10-26T10:00:02Z', 'Бот', 'Первый пункт — порт. Второй — сервер.']
  ],
  rowMetadata: {
    1: { isBot: true, userId: 77 },
    3: { isBot: true, userId: 77, replyToMessageId: 2 }
  },
  replyToMessageId: 3,
  triggerText: 'Объясни второй пункт.',
  rubric: { mustIncludeAny: [['сервер']], mustNotIncludeAny: [['устаревшее']] }
});

describe('conversation experiment controls', () => {
  test('compares the saved baseline with the real production candidate without adding experimental rules', () => {
    const baseline = buildAnswerMessages(fixture);
    const candidate = baseline.map((message) => ({
      ...message,
      content:
        message.role === 'system'
          ? 'Candidate production policy.'
          : message.content
    }));

    expect(compareProductionPrompts(baseline, candidate, 'A')).toEqual(
      baseline
    );
    expect(compareProductionPrompts(baseline, candidate, 'D')).toEqual(
      candidate
    );
    expect(baseline[0]?.content).not.toBe('Candidate production policy.');
  });

  test('rejects changed conversation data instead of comparing different evidence', () => {
    const baseline = buildAnswerMessages(fixture);
    const candidate = baseline.map((message) => ({
      ...message,
      content:
        message.role === 'user'
          ? 'Different request or history.'
          : message.content
    }));

    expect(() => compareProductionPrompts(baseline, candidate, 'D')).toThrow(
      'conversation data'
    );
  });

  test('removes all bot content including the explicit target in omitted history', () => {
    const baseline = buildAnswerMessages(fixture);
    const omitted = transformExperimentMessages(baseline, 'omitted', new Set());
    const user = omitted[1]?.content ?? '';

    expect(user).not.toContain('Устаревшее мнение.');
    expect(user).not.toContain('Первый пункт');
    expect(user).toContain('Новая тема.');
    expect(user).toContain('Объясни второй пункт.');
    expect(user).toContain('replyToMessageId=3');
    expect(user).toContain('includedMessageCount=1');
    expect(omitted[0]).toEqual(baseline[0]);
    expect(baseline[1]?.content).toContain('Первый пункт');
  });

  test('retains the bot target and explicit ancestors without unrelated bot replies', () => {
    const ancestors = getReplyAncestorIds(fixture.replyContext);
    const selected = transformExperimentMessages(
      buildAnswerMessages(fixture),
      'ancestors',
      ancestors
    );

    expect([...ancestors]).toEqual([3, 2]);
    expect(selected[1]?.content).toContain('Первый пункт');
    expect(selected[1]?.content).not.toContain('Устаревшее мнение.');
    expect(selected[1]?.content).toContain('Новая тема.');
  });

  test('preserves exactly the same fitted human rows even for a full budget', () => {
    const large = createFixture({
      id: 'large',
      intent: 'answer',
      targetDisplayName: 'Алиса',
      rows: Array.from({ length: 80 }, (_, i) => [
        '2026-10-26T10:00:00Z',
        i % 2 ? 'Алиса' : 'Бот',
        `Тема ${i}: ${'Подробности. '.repeat(300)}`
      ]),
      rowMetadata: Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [
          i * 2 + 1,
          { isBot: true, userId: 77 }
        ])
      ),
      triggerText: '@hrupa_bot подведи итог',
      rubric: {
        mustIncludeAny: [['тема']],
        mustNotIncludeAny: [['нет истории']]
      }
    });
    const baseline = buildAnswerMessages(large);
    const humanRows = (content: string) =>
      content.split('\n').filter((line) => /actor=user#/.test(line));

    expect(baseline[1]?.content).toContain('contextTruncated=true');
    for (const variant of ['full', 'omitted', 'ancestors'] as const) {
      const changed = transformExperimentMessages(baseline, variant, new Set());
      expect(humanRows(changed[1]?.content ?? '')).toEqual(
        humanRows(baseline[1]?.content ?? '')
      );
    }
  });

  test('does not mistake bot-like quoted text for the row author', () => {
    const original = buildAnswerMessages(fixture);
    const messages = original.map((message) => ({
      ...message,
      content: message.content.replace(
        'Новая тема.',
        'Цитата actor=bot Бот внутри текста.'
      )
    }));
    const omitted = transformExperimentMessages(messages, 'omitted', new Set());

    expect(omitted[1]?.content).toContain(
      'Цитата actor=bot Бот внутри текста.'
    );
  });
});
