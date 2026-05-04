import type { WeeklyEventCandidate, WeeklyMessage } from '../types.js';
import { createCandidate, getParticipantIds, getTimestamp } from './shared.js';

const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_EXPAND_GAP_MS = 5 * 60 * 1000;
const BURST_MIN_MESSAGES = 12;
const BURST_MIN_PARTICIPANTS = 2;

export function detectBursts(
  messages: WeeklyMessage[]
): WeeklyEventCandidate[] {
  const candidates: WeeklyEventCandidate[] = [];
  const emitted = new Set<string>();

  for (let startIndex = 0; startIndex < messages.length; startIndex += 1) {
    const windowStart = getTimestamp(messages[startIndex]);
    let endIndex = startIndex;

    while (
      endIndex + 1 < messages.length &&
      getTimestamp(messages[endIndex + 1]) - windowStart <= BURST_WINDOW_MS
    ) {
      endIndex += 1;
    }

    const windowMessages = messages.slice(startIndex, endIndex + 1);

    if (
      windowMessages.length < BURST_MIN_MESSAGES ||
      getParticipantIds(windowMessages).length < BURST_MIN_PARTICIPANTS
    ) {
      continue;
    }

    const expandedMessages = expandBurstMessages({
      messages,
      startIndex,
      endIndex
    });
    const key = `${expandedMessages[0]?.messageId ?? 0}:${
      expandedMessages.at(-1)?.messageId ?? 0
    }`;

    if (emitted.has(key)) {
      continue;
    }

    emitted.add(key);
    candidates.push(
      createCandidate({
        idPrefix: 'burst',
        kinds: ['burst'],
        messages: expandedMessages,
        reasons: [
          `${windowMessages.length} messages in a 10-minute window`,
          `${getParticipantIds(windowMessages).length} participants`
        ]
      })
    );
  }

  return candidates;
}

function expandBurstMessages(input: {
  messages: WeeklyMessage[];
  startIndex: number;
  endIndex: number;
}): WeeklyMessage[] {
  let expandedStart = input.startIndex;
  let expandedEnd = input.endIndex;

  while (
    expandedStart > 0 &&
    getTimestamp(input.messages[expandedStart]) -
      getTimestamp(input.messages[expandedStart - 1]) <=
      BURST_EXPAND_GAP_MS
  ) {
    expandedStart -= 1;
  }

  while (
    expandedEnd + 1 < input.messages.length &&
    getTimestamp(input.messages[expandedEnd + 1]) -
      getTimestamp(input.messages[expandedEnd]) <=
      BURST_EXPAND_GAP_MS
  ) {
    expandedEnd += 1;
  }

  return input.messages.slice(expandedStart, expandedEnd + 1);
}
