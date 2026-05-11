import { answerActionConfig } from '../config/runtime/index.js';
import type { AssistantIntent } from '../domain/models.js';
import { normalizeSpeechText } from './speech-cleanup.js';

export const OUTBOUND_TTS_ANSWER_MAX_CHARS =
  answerActionConfig.outboundTts.maxChars;
export const OUTBOUND_TTS_ANSWER_BASE_PROBABILITY =
  answerActionConfig.outboundTts.baseProbability;
export const OUTBOUND_TTS_ANSWER_MIN_ELIGIBLE_TEXT_GAP =
  answerActionConfig.outboundTts.minEligibleTextGap;
export const OUTBOUND_TTS_ANSWER_PITY_GAP =
  answerActionConfig.outboundTts.pityGap;

export type AnswerTtsOutputMode = 'text' | 'voice';

export type AnswerTtsChatState = {
  answerLastOutputMode: AnswerTtsOutputMode | null;
  answerEligibleTextSinceVoice: number;
  answerEligibleTextStreak: number;
};

export type AnswerTtsDecision =
  | {
      shouldAttempt: true;
      reason: 'probability' | 'pity';
      speechText: string;
    }
  | {
      shouldAttempt: false;
      reason:
        | 'intent'
        | 'empty'
        | 'length'
        | 'link'
        | 'mention'
        | 'code'
        | 'structured'
        | 'content_loss'
        | 'cadence'
        | 'probability';
    };

export function decideAnswerTts(input: {
  intent: AssistantIntent;
  text: string;
  chatState: AnswerTtsChatState;
  random: () => number;
}): AnswerTtsDecision {
  if (input.intent !== 'answer') {
    return { shouldAttempt: false, reason: 'intent' };
  }

  const cleanup = normalizeSpeechText(
    input.text,
    OUTBOUND_TTS_ANSWER_MAX_CHARS
  );

  if (!cleanup.ok) {
    return { shouldAttempt: false, reason: cleanup.reason };
  }

  if (
    input.chatState.answerLastOutputMode === 'voice' ||
    input.chatState.answerEligibleTextSinceVoice <
      OUTBOUND_TTS_ANSWER_MIN_ELIGIBLE_TEXT_GAP
  ) {
    return { shouldAttempt: false, reason: 'cadence' };
  }

  if (
    input.chatState.answerEligibleTextStreak >= OUTBOUND_TTS_ANSWER_PITY_GAP
  ) {
    return {
      shouldAttempt: true,
      reason: 'pity',
      speechText: cleanup.text
    };
  }

  if (input.random() < OUTBOUND_TTS_ANSWER_BASE_PROBABILITY) {
    return {
      shouldAttempt: true,
      reason: 'probability',
      speechText: cleanup.text
    };
  }

  return { shouldAttempt: false, reason: 'probability' };
}
