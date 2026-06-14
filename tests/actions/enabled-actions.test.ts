import { describe, expect, test } from 'vitest';

import {
  chatActionRequiredFeatures,
  chatActions
} from '../../src/app/actions/index.js';

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
      'sex'
    ]);

    expect(chatActions.map((action) => action.commands)).toEqual([
      ['summarize'],
      ['decide'],
      ['answer'],
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

  test('defines centralized feature requirements for configured-chat actions', () => {
    expect(chatActionRequiredFeatures).toEqual({
      answer: 'answer',
      summarize: 'summarize',
      decide: 'decide',
      translate: 'translate',
      read: 'read',
      transcribe: 'transcribe',
      meme: 'meme',
      sex: 'sex'
    });
  });
});
