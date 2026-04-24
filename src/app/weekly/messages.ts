import type { StoredMediaArtifact } from '../../database/index.js';
import type { StoredMessage } from '../../domain/models.js';
import { getWeeklyPreferredMediaSummary } from './media.js';
import type { WeeklyMessage, WeeklyStats } from './types.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type WeeklyMessageReader = {
  getMessagesInRange(input: {
    chatId: number;
    fromInclusive: string;
    toExclusive: string;
  }): StoredMessage[];
};

type WeeklyArtifactReader = {
  getSuccessfulMediaArtifactsForMessages(input: {
    chatId: number;
    messageIds: number[];
  }): StoredMediaArtifact[];
};

export function loadWeeklyMessages(input: {
  db: WeeklyMessageReader;
  chatId: number;
  now: string;
}): WeeklyMessage[] {
  const toExclusive = input.now;
  const fromInclusive = new Date(Date.parse(input.now) - WEEK_MS).toISOString();

  return input.db
    .getMessagesInRange({
      chatId: input.chatId,
      fromInclusive,
      toExclusive
    })
    .filter((message) => !message.isBot)
    .map((message) => ({
      ...message,
      mediaSummary: null
    }));
}

export function enrichWeeklyMessagesWithMedia(input: {
  db: WeeklyArtifactReader;
  messages: WeeklyMessage[];
}): WeeklyMessage[] {
  if (input.messages.length === 0) {
    return input.messages;
  }

  const chatId = input.messages[0]?.chatId;
  const messageIds = input.messages.map((message) => message.messageId);

  if (chatId === undefined || messageIds.length === 0) {
    return input.messages;
  }

  const artifacts = input.db.getSuccessfulMediaArtifactsForMessages({
    chatId,
    messageIds
  });

  return input.messages.map((message) => ({
    ...message,
    mediaSummary: getWeeklyPreferredMediaSummary(artifacts, message)
  }));
}

export function buildWeeklyStats(messages: WeeklyMessage[]): WeeklyStats {
  const byDay = new Map<string, number>();
  const participants = new Set<number>();
  let replyMessages = 0;
  let mediaMessages = 0;
  let mediaMessagesWithSuccessfulSummaries = 0;

  for (const message of messages) {
    const day = message.createdAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);

    if (message.userId !== null) {
      participants.add(message.userId);
    }

    if (message.replyToMessageId !== null) {
      replyMessages += 1;
    }

    if (message.mediaSnapshot) {
      mediaMessages += 1;
    }

    if (message.mediaSummary) {
      mediaMessagesWithSuccessfulSummaries += 1;
    }
  }

  return {
    totalHumanMessages: messages.length,
    participants: participants.size,
    replyMessages,
    mediaMessages,
    mediaMessagesWithSuccessfulSummaries,
    topActiveDays: [...byDay.entries()]
      .sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
      )
      .slice(0, 3)
  };
}
