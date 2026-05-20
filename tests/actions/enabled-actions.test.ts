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
      'meme',
      'publish',
      'news'
    ]);

    expect(chatActions.map((action) => action.commands)).toEqual([
      ['summarize'],
      ['decide'],
      ['answer'],
      ['translate'],
      ['read'],
      ['meme'],
      ['publish'],
      ['news']
    ]);

    expect(
      chatActions
        .filter((action) => !['publish', 'news'].includes(action.intent))
        .every((action) => action.modes.includes('chat'))
    ).toBe(true);
    expect(
      chatActions.find((action) => action.intent === 'publish')?.modes
    ).toEqual(['private_admin']);
    expect(
      chatActions.find((action) => action.intent === 'news')?.modes
    ).toEqual(['private_admin']);
  });
});
