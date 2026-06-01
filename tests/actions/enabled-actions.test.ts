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
      'transcribe',
      'meme',
      'publish'
    ]);

    expect(chatActions.map((action) => action.commands)).toEqual([
      ['summarize'],
      ['decide'],
      ['answer'],
      ['translate'],
      ['read'],
      ['transcribe'],
      ['meme'],
      ['publish']
    ]);

    expect(
      chatActions
        .filter((action) => action.intent !== 'publish')
        .every((action) => action.modes.includes('chat'))
    ).toBe(true);
    expect(
      chatActions.find((action) => action.intent === 'publish')?.modes
    ).toEqual(['private_admin']);
  });
});
