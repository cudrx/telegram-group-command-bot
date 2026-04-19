import { describe, expect, test } from 'vitest';

import {
  isNearDuplicateReplyText,
  normalizeReplyText
} from '../src/domain/reply-text-similarity.js';

describe('reply text similarity', () => {
  test('normalizes case, punctuation, repeated spaces, and yo/e differences', () => {
    expect(normalizeReplyText('Ну ты и говно, да.\nА я тут просто сижу')).toBe(
      'ну ты и говно да а я тут просто сижу'
    );
    expect(normalizeReplyText('Ёбаный   тест')).toBe('ебаный тест');
  });

  test('detects exact normalized duplicates', () => {
    expect(
      isNearDuplicateReplyText('Ты анальная пробка?', 'ты анальная пробка')
    ).toBe(true);
  });

  test('detects near duplicates with tiny punctuation or one-word drift', () => {
    expect(
      isNearDuplicateReplyText(
        'ну ты и говно, да\nа я тут просто сижу, как винтик в дыре',
        'ну ты и говно да а я просто сижу как винтик в дыре'
      )
    ).toBe(true);
  });

  test('does not collapse unrelated short replies', () => {
    expect(isNearDuplicateReplyText('ты где', 'я дома')).toBe(false);
  });
});
