import type {
  WeeklyEventCandidate,
  WeeklyEventKind,
  WeeklyMessage
} from './types.js';

const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_EXPAND_GAP_MS = 5 * 60 * 1000;
const BURST_MIN_MESSAGES = 12;
const BURST_MIN_PARTICIPANTS = 2;
const CONTEXT_MESSAGES_EACH_SIDE = 5;
const MEDIA_DENSE_WINDOW_MS = 10 * 60 * 1000;
const MEDIA_DENSE_MIN_MESSAGES = 4;

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

function detectBursts(messages: WeeklyMessage[]): WeeklyEventCandidate[] {
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

    let expandedStart = startIndex;
    let expandedEnd = endIndex;

    while (
      expandedStart > 0 &&
      getTimestamp(messages[expandedStart]) -
        getTimestamp(messages[expandedStart - 1]) <=
        BURST_EXPAND_GAP_MS
    ) {
      expandedStart -= 1;
    }

    while (
      expandedEnd + 1 < messages.length &&
      getTimestamp(messages[expandedEnd + 1]) -
        getTimestamp(messages[expandedEnd]) <=
        BURST_EXPAND_GAP_MS
    ) {
      expandedEnd += 1;
    }

    const expandedMessages = messages.slice(expandedStart, expandedEnd + 1);
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

function detectReplyHotspots(
  messages: WeeklyMessage[]
): WeeklyEventCandidate[] {
  const byMessageId = new Map(
    messages.map((message, index) => [message.messageId, { message, index }])
  );
  const repliesByAnchor = groupDirectReplies(messages);
  const candidates: WeeklyEventCandidate[] = [];

  for (const [anchorId, replies] of repliesByAnchor.entries()) {
    if (replies.length < 2) {
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

function detectReplyChains(messages: WeeklyMessage[]): WeeklyEventCandidate[] {
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

      return component.length >= 3 && replyCount >= 2;
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

function detectMediaMoments(messages: WeeklyMessage[]): WeeklyEventCandidate[] {
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

function createCandidate(input: {
  idPrefix: string;
  kinds: WeeklyEventKind[];
  messages: WeeklyMessage[];
  reasons: string[];
}): WeeklyEventCandidate {
  const messages = sortMessages(input.messages);
  const firstMessage = messages[0];
  const lastMessage = messages.at(-1);

  if (!firstMessage || !lastMessage) {
    throw new Error('Cannot create a weekly event candidate without messages');
  }

  const messageIds = getMessageIds(messages);
  const participantIds = getParticipantIds(messages);

  return {
    id: `${input.idPrefix}:${messageIds[0]}-${messageIds.at(-1)}`,
    kinds: [...input.kinds].sort(),
    startAt: firstMessage.createdAt,
    endAt: lastMessage.createdAt,
    messageIds,
    participantIds,
    score: scoreCandidate({
      messageCount: messageIds.length,
      participantCount: participantIds.length,
      replyCount: countReplies(messages),
      maxRepliesToOneMessage: countMaxRepliesToOneMessage(messages),
      mediaSummaryCount: messages.filter((message) =>
        message.mediaSummary?.trim()
      ).length
    }),
    reasons: [...input.reasons].sort()
  };
}

function scoreCandidate(input: {
  messageCount: number;
  participantCount: number;
  replyCount: number;
  maxRepliesToOneMessage: number;
  mediaSummaryCount: number;
}): number {
  return (
    input.messageCount +
    input.participantCount * 3 +
    input.replyCount * 2 +
    input.maxRepliesToOneMessage * 4 +
    input.mediaSummaryCount * 3
  );
}

function sortMessages(messages: WeeklyMessage[]): WeeklyMessage[] {
  return [...messages].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.messageId - right.messageId
  );
}

function getTimestamp(message: WeeklyMessage | undefined): number {
  return Date.parse(message?.createdAt ?? '');
}

function getMessageIds(messages: WeeklyMessage[]): number[] {
  return [...new Set(messages.map((message) => message.messageId))].sort(
    (left, right) => left - right
  );
}

function getParticipantIds(messages: WeeklyMessage[]): number[] {
  return [
    ...new Set(
      messages
        .map((message) => message.userId)
        .filter((userId): userId is number => userId !== null)
    )
  ].sort((left, right) => left - right);
}

function groupDirectReplies(
  messages: WeeklyMessage[]
): Map<number, WeeklyMessage[]> {
  const repliesByAnchor = new Map<number, WeeklyMessage[]>();

  for (const message of messages) {
    if (message.replyToMessageId === null) {
      continue;
    }

    repliesByAnchor.set(message.replyToMessageId, [
      ...(repliesByAnchor.get(message.replyToMessageId) ?? []),
      message
    ]);
  }

  return repliesByAnchor;
}

function uniqueMessages(messages: WeeklyMessage[]): WeeklyMessage[] {
  const byMessageId = new Map<number, WeeklyMessage>();

  for (const message of messages) {
    byMessageId.set(message.messageId, message);
  }

  return sortMessages([...byMessageId.values()]);
}

function countReplies(messages: WeeklyMessage[]): number {
  const ids = new Set(messages.map((message) => message.messageId));

  return messages.filter(
    (message) =>
      message.replyToMessageId !== null && ids.has(message.replyToMessageId)
  ).length;
}

function countMaxRepliesToOneMessage(messages: WeeklyMessage[]): number {
  const ids = new Set(messages.map((message) => message.messageId));
  const counts = new Map<number, number>();

  for (const message of messages) {
    if (
      message.replyToMessageId === null ||
      !ids.has(message.replyToMessageId)
    ) {
      continue;
    }

    counts.set(
      message.replyToMessageId,
      (counts.get(message.replyToMessageId) ?? 0) + 1
    );
  }

  return Math.max(0, ...counts.values());
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
