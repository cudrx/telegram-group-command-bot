import { describe, expect, test } from 'vitest';

import { selectMemeSources } from '../../../src/app/actions/meme/source-selection.js';

describe('selectMemeSources', () => {
  test('returns a shuffled copy capped at max source attempts', () => {
    const subreddits = ['one', 'two', 'three', 'four'];
    const randomValues = [0.25, 0.75, 0.1];
    const selected = selectMemeSources({
      subreddits,
      maxSourceAttempts: 2,
      random: () => randomValues.shift() ?? 0
    });

    expect(selected).toEqual(['two', 'four']);
    expect(subreddits).toEqual(['one', 'two', 'three', 'four']);
  });

  test('tries each subreddit at most once in one run', () => {
    const selected = selectMemeSources({
      subreddits: ['same', 'same', 'other', 'same', 'third'],
      maxSourceAttempts: 5,
      random: () => 0
    });

    expect(selected).toEqual(['same', 'other', 'third']);
  });

  test('returns all unique subreddits when attempts exceed source count', () => {
    const selected = selectMemeSources({
      subreddits: ['alpha', 'beta'],
      maxSourceAttempts: 10,
      random: () => 0.99
    });

    expect(selected).toHaveLength(2);
    expect(new Set(selected)).toEqual(new Set(['alpha', 'beta']));
  });
});
