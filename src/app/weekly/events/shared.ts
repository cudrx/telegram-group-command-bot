import { weeklyActionConfig } from '../../../config/runtime/index.js';
import type {
  WeeklyEventCandidate,
  WeeklyEventKind,
  WeeklyMessage
} from '../types.js';

export function createCandidate(input: {
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

export function sortMessages(messages: WeeklyMessage[]): WeeklyMessage[] {
  return [...messages].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.messageId - right.messageId
  );
}

export function getTimestamp(message: WeeklyMessage | undefined): number {
  return Date.parse(message?.createdAt ?? '');
}

export function getParticipantIds(messages: WeeklyMessage[]): number[] {
  return [
    ...new Set(
      messages
        .map((message) => message.userId)
        .filter((userId): userId is number => userId !== null)
    )
  ].sort((left, right) => left - right);
}

export function groupDirectReplies(
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

export function uniqueMessages(messages: WeeklyMessage[]): WeeklyMessage[] {
  const byMessageId = new Map<number, WeeklyMessage>();

  for (const message of messages) {
    byMessageId.set(message.messageId, message);
  }

  return sortMessages([...byMessageId.values()]);
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
    input.participantCount * weeklyActionConfig.scoring.participantWeight +
    input.replyCount * weeklyActionConfig.scoring.replyWeight +
    input.maxRepliesToOneMessage *
      weeklyActionConfig.scoring.maxRepliesToOneMessageWeight +
    input.mediaSummaryCount * weeklyActionConfig.scoring.mediaSummaryWeight
  );
}

function getMessageIds(messages: WeeklyMessage[]): number[] {
  return [...new Set(messages.map((message) => message.messageId))].sort(
    (left, right) => left - right
  );
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
