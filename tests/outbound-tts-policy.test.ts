import { describe, expect, test } from 'vitest';

import { decideAnswerTts } from '../src/tts/outbound-policy.js';

const baseState = {
  answerLastOutputMode: null,
  answerEligibleTextSinceVoice: 3,
  answerEligibleTextStreak: 0
} as const;

describe('decideAnswerTts', () => {
  test('skips non-answer intents', () => {
    expect(
      decideAnswerTts({
        intent: 'summarize',
        text: 'коротко',
        chatState: baseState,
        random: () => 0
      })
    ).toMatchObject({ shouldAttempt: false, reason: 'intent' });
  });

  test('accepts short clean answer when probability passes', () => {
    expect(
      decideAnswerTts({
        intent: 'answer',
        text: 'да, звучит нормально',
        chatState: baseState,
        random: () => 0.1
      })
    ).toEqual({
      shouldAttempt: true,
      reason: 'probability',
      speechText: 'да, звучит нормально'
    });
  });

  test('skips immediately after a voice reply', () => {
    expect(
      decideAnswerTts({
        intent: 'answer',
        text: 'коротко',
        chatState: {
          answerLastOutputMode: 'voice',
          answerEligibleTextSinceVoice: 0,
          answerEligibleTextStreak: 0
        },
        random: () => 0
      })
    ).toMatchObject({ shouldAttempt: false, reason: 'cadence' });
  });

  test('skips before the minimum eligible text gap', () => {
    expect(
      decideAnswerTts({
        intent: 'answer',
        text: 'коротко',
        chatState: {
          answerLastOutputMode: 'text',
          answerEligibleTextSinceVoice: 2,
          answerEligibleTextStreak: 2
        },
        random: () => 0
      })
    ).toMatchObject({ shouldAttempt: false, reason: 'cadence' });
  });

  test('forces voice after pity gap', () => {
    expect(
      decideAnswerTts({
        intent: 'answer',
        text: 'коротко',
        chatState: {
          answerLastOutputMode: 'text',
          answerEligibleTextSinceVoice: 12,
          answerEligibleTextStreak: 12
        },
        random: () => 0.99
      })
    ).toMatchObject({ shouldAttempt: true, reason: 'pity' });
  });

  test('skips dirty answer text', () => {
    expect(
      decideAnswerTts({
        intent: 'answer',
        text: 'смотри https://example.com',
        chatState: baseState,
        random: () => 0
      })
    ).toMatchObject({ shouldAttempt: false, reason: 'link' });
  });
});
