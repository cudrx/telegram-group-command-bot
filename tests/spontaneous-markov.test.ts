import { expect, test } from 'vitest';

import { generateMarkovDraft } from '../src/app/spontaneous/markov.js';

test('recombines observed transitions without copying a training message', () => {
  const choices = [0, 0, 0.8, 0];
  expect(
    generateMarkovDraft(
      ['наш сервер танцует', 'твой сервер грустит'],
      () => choices.shift() ?? 0
    )
  ).toBe('наш сервер грустит');
});

test('declines an empty or unmixable corpus', () => {
  expect(generateMarkovDraft([], () => 0)).toBeNull();
  expect(generateMarkovDraft(['кот ест суп'], () => 0)).toBeNull();
});

test('bounds cyclic walks and generation attempts', () => {
  let calls = 0;
  const result = generateMarkovDraft(['кот кот кот кот'], () => {
    calls++;
    return 0;
  });
  expect(result).toBeNull();
  expect(calls).toBeLessThan(2000);
});
