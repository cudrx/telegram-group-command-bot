import { detectBursts } from './events/bursts.js';
import { detectMediaMoments } from './events/media.js';
import { detectReplyChains, detectReplyHotspots } from './events/replies.js';
import { sortMessages } from './events/shared.js';
import type { WeeklyEventCandidate, WeeklyMessage } from './types.js';

export function buildWeeklyCandidates(
  messages: WeeklyMessage[]
): WeeklyEventCandidate[] {
  const sortedMessages = sortMessages(messages);

  return [
    ...detectBursts(sortedMessages),
    ...detectReplyHotspots(sortedMessages),
    ...detectReplyChains(sortedMessages),
    ...detectMediaMoments(sortedMessages)
  ].sort((left, right) => left.id.localeCompare(right.id));
}
