import { describe, expect, test } from 'vitest';

import { chatActions } from '../../src/app/actions/index.js';

describe('chatActions', () => {
  test('registers all supported commands in action folders', () => {
    expect(chatActions.map((action) => action.intent)).toEqual([
      'summarize',
      'decide',
      'answer',
      'translate',
      'read',
      'meme'
    ]);

    expect(chatActions.map((action) => action.commands)).toEqual([
      ['summarize'],
      ['decide'],
      ['answer'],
      ['translate'],
      ['read'],
      ['meme']
    ]);

    expect(chatActions.every((action) => action.modes.includes('chat'))).toBe(
      true
    );
  });
});
