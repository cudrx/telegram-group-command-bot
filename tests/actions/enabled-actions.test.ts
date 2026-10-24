import { describe, expect, test } from 'vitest';

import { chatActions } from '../../src/app/actions/index.js';

describe('chatActions', () => {
  test('registers all supported commands in action folders', () => {
    expect(chatActions.map((action) => action.intent)).toEqual([
      'translate',
      'read',
      'transcribe',
      'meme',
      'sex'
    ]);

    expect(chatActions.map((action) => action.commands)).toEqual([
      ['translate'],
      ['read'],
      ['transcribe'],
      ['meme'],
      ['sex']
    ]);

    expect(chatActions.every((action) => action.modes.includes('chat'))).toBe(
      true
    );
  });
});
