import { weeklyActionConfig } from '../../../config/runtime/index.js';
import type { WeeklyEventCandidate, WeeklyMessage } from '../types.js';
import {
  createCandidate,
  groupDirectReplies,
  uniqueMessages
} from './shared.js';

const CONTEXT_MESSAGES_EACH_SIDE =
  weeklyActionConfig.replies.contextMessagesEachSide;

export function detectReplyHotspots(
  messages: WeeklyMessage[]
): WeeklyEventCandidate[] {
  const byMessageId = new Map(
    messages.map((message, index) => [message.messageId, { message, index }])
  );
  const repliesByAnchor = groupDirectReplies(messages);
  const candidates: WeeklyEventCandidate[] = [];

  for (const [anchorId, replies] of repliesByAnchor.entries()) {
    if (replies.length < weeklyActionConfig.replies.minHotspotReplies) {
      continue;
    }

    const anchor = byMessageId.get(anchorId);

    if (!anchor) {
      continue;
    }

    const nearby = messages.slice(
      Math.max(0, anchor.index - CONTEXT_MESSAGES_EACH_SIDE),
      Math.min(messages.length, anchor.index + CONTEXT_MESSAGES_EACH_SIDE + 1)
    );
    const candidateMessages = uniqueMessages([
      anchor.message,
      ...replies,
      ...nearby
    ]);

    candidates.push(
      createCandidate({
        idPrefix: `reply-hotspot-${anchorId}`,
        kinds: ['reply_hotspot'],
        messages: candidateMessages,
        reasons: [
          `message ${anchorId} received ${replies.length} direct replies`
        ]
      })
    );
  }

  return candidates;
}

export function detectReplyChains(
  messages: WeeklyMessage[]
): WeeklyEventCandidate[] {
  const ids = new Set(messages.map((message) => message.messageId));
  const parent = new Map<number, number>();

  for (const message of messages) {
    parent.set(message.messageId, message.messageId);
  }

  for (const message of messages) {
    if (
      message.replyToMessageId !== null &&
      ids.has(message.replyToMessageId)
    ) {
      union(parent, message.messageId, message.replyToMessageId);
    }
  }

  const byRoot = new Map<number, WeeklyMessage[]>();

  for (const message of messages) {
    const root = find(parent, message.messageId);
    byRoot.set(root, [...(byRoot.get(root) ?? []), message]);
  }

  return [...byRoot.values()]
    .filter((component) => {
      const replyCount = component.filter(
        (message) =>
          message.replyToMessageId !== null && ids.has(message.replyToMessageId)
      ).length;

      return (
        component.length >= weeklyActionConfig.replies.minChainMessages &&
        replyCount >= weeklyActionConfig.replies.minChainReplies
      );
    })
    .map((component) =>
      createCandidate({
        idPrefix: 'reply-chain',
        kinds: ['reply_chain'],
        messages: component,
        reasons: [`${component.length} connected messages in a reply chain`]
      })
    );
}

function find(parent: Map<number, number>, id: number): number {
  const current = parent.get(id);

  if (current === undefined || current === id) {
    return id;
  }

  const root = find(parent, current);
  parent.set(id, root);

  return root;
}

function union(parent: Map<number, number>, left: number, right: number): void {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);

  if (leftRoot !== rightRoot) {
    parent.set(Math.max(leftRoot, rightRoot), Math.min(leftRoot, rightRoot));
  }
}
