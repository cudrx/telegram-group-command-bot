import type { WeeklyEventCandidate, WeeklyMessage } from '../types.js';
import {
  createCandidate,
  getTimestamp,
  groupDirectReplies,
  uniqueMessages
} from './shared.js';

const MEDIA_DENSE_WINDOW_MS = 10 * 60 * 1000;
const MEDIA_DENSE_MIN_MESSAGES = 4;

export function detectMediaMoments(
  messages: WeeklyMessage[]
): WeeklyEventCandidate[] {
  const repliesByAnchor = groupDirectReplies(messages);
  const byMessageId = new Map(
    messages.map((message) => [message.messageId, message])
  );
  const clusters: Array<{ messages: WeeklyMessage[]; reasons: string[] }> = [];

  for (const message of messages) {
    if (!message.mediaSummary?.trim()) {
      continue;
    }

    const directReplies = repliesByAnchor.get(message.messageId) ?? [];
    const parent = message.replyToMessageId
      ? byMessageId.get(message.replyToMessageId)
      : undefined;
    const nearby = messages.filter(
      (nearbyMessage) =>
        Math.abs(getTimestamp(nearbyMessage) - getTimestamp(message)) <=
        MEDIA_DENSE_WINDOW_MS
    );
    const hasReplyActivity = directReplies.length > 0 || parent !== undefined;
    const hasDenseActivity = nearby.length >= MEDIA_DENSE_MIN_MESSAGES;

    if (!hasReplyActivity && !hasDenseActivity) {
      continue;
    }

    mergeMediaMomentCluster(clusters, {
      messages: uniqueMessages([
        ...(parent ? [parent] : []),
        message,
        ...directReplies,
        ...nearby
      ]),
      reasons: [
        hasReplyActivity
          ? `media message ${message.messageId} had reply activity`
          : `media message ${message.messageId} appeared in dense nearby activity`
      ]
    });
  }

  return clusters.map((cluster) =>
    createCandidate({
      idPrefix: 'media-moment',
      kinds: ['media_moment'],
      messages: cluster.messages,
      reasons: cluster.reasons
    })
  );
}

function mergeMediaMomentCluster(
  clusters: Array<{ messages: WeeklyMessage[]; reasons: string[] }>,
  nextCluster: { messages: WeeklyMessage[]; reasons: string[] }
): void {
  const overlappingIndexes: number[] = [];
  const nextIds = new Set(
    nextCluster.messages.map((message) => message.messageId)
  );

  for (const [index, cluster] of clusters.entries()) {
    if (cluster.messages.some((message) => nextIds.has(message.messageId))) {
      overlappingIndexes.push(index);
    }
  }

  if (overlappingIndexes.length === 0) {
    clusters.push(nextCluster);
    return;
  }

  let merged = nextCluster;

  for (const index of overlappingIndexes) {
    const cluster = clusters[index];

    if (!cluster) {
      continue;
    }

    merged = {
      messages: uniqueMessages([...merged.messages, ...cluster.messages]),
      reasons: [...merged.reasons, ...cluster.reasons]
    };
  }

  for (const index of [...overlappingIndexes].sort(
    (left, right) => right - left
  )) {
    clusters.splice(index, 1);
  }

  clusters.push({
    messages: merged.messages,
    reasons: [...new Set(merged.reasons)]
  });
}
