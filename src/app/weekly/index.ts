import type { DatabaseClient } from '../../database/index.js';
import { loadPrompt } from '../../llm/prompt-files.js';
import { serializeError, type AppLogger } from '../../logging/logger.js';
import { formatTelegramHtmlReply } from '../telegram-html.js';
import { buildWeeklyCandidates } from './events.js';
import { formatWeeklyDataset } from './format.js';
import {
  buildWeeklyStats,
  enrichWeeklyMessagesWithMedia,
  loadWeeklyMessages
} from './messages.js';
import { selectWeeklyEvents } from './select.js';
import type {
  WeeklyDataset,
  WeeklyEventCandidate,
  WeeklyMessage,
  WeeklyParticipantStats
} from './types.js';
import type {
  BotIdentity,
  LlmClient,
  WeeklyDispatcher
} from '../chat-orchestrator/types.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKLY_EVENT_EXCERPT_LIMIT = 12;

export type WeeklyServiceDeps = {
  db: DatabaseClient;
  qwen: Pick<LlmClient, 'generateWeekly'>;
  env: {
    telegramChatId: number;
  };
  bot: BotIdentity;
  weeklyDispatcher: WeeklyDispatcher;
  logger: AppLogger;
  now: () => string;
};

export type WeeklyPreview = {
  dataset: string;
  weeklyDataset: WeeklyDataset;
};

export function buildWeeklyPreview(input: {
  db: Pick<
    DatabaseClient,
    'getMessagesInRange' | 'getSuccessfulMediaArtifactsForMessages'
  >;
  chatId: number;
  now: string;
}): WeeklyPreview {
  const messages = loadWeeklyMessages({
    db: input.db,
    chatId: input.chatId,
    now: input.now
  });
  const enrichedMessages = enrichWeeklyMessagesWithMedia({
    db: input.db,
    messages
  });
  const selectedEvents = selectWeeklyEvents(
    buildWeeklyCandidates(enrichedMessages)
  );
  const weeklyDataset = buildWeeklyDataset({
    now: input.now,
    messages: enrichedMessages,
    selectedEvents
  });

  return {
    dataset: formatWeeklyDataset(weeklyDataset),
    weeklyDataset
  };
}

export class WeeklyService {
  constructor(private readonly deps: WeeklyServiceDeps) {}

  async generateAndSend(): Promise<void> {
    const preview = buildWeeklyPreview({
      db: this.deps.db,
      chatId: this.deps.env.telegramChatId,
      now: this.deps.now()
    });
    const result = await this.deps.qwen.generateWeekly({
      assistantInstructions: loadPrompt('base'),
      weeklyDataset: preview.dataset
    });
    const replyText = formatTelegramHtmlReply(result.text);
    const sent = await this.deps.weeklyDispatcher({
      chatId: this.deps.env.telegramChatId,
      text: replyText
    });
    const targetChatState = this.deps.db.getChatState(
      this.deps.env.telegramChatId
    );

    this.deps.db.saveBotMessage({
      chatId: this.deps.env.telegramChatId,
      chatType: targetChatState?.chatType ?? 'group',
      chatTitle: targetChatState?.title ?? null,
      messageId: sent.messageId,
      text: replyText,
      createdAt: sent.createdAt,
      userId: this.deps.bot.userId,
      username: this.deps.bot.username,
      displayName: this.deps.bot.displayName
    });
  }
}

export async function runWeeklyJob(deps: WeeklyServiceDeps): Promise<void> {
  try {
    deps.logger.debug('weekly_job_started', {
      chatId: deps.env.telegramChatId
    });

    await new WeeklyService(deps).generateAndSend();

    deps.logger.debug('weekly_job_completed', {
      chatId: deps.env.telegramChatId
    });
  } catch (error) {
    deps.logger.error('weekly_job_failed', {
      chatId: deps.env.telegramChatId,
      ...serializeError(error)
    });
  }
}

export function buildWeeklyDataset(input: {
  now: string;
  messages: WeeklyMessage[];
  selectedEvents: WeeklyEventCandidate[];
}): WeeklyDataset {
  const fromInclusive = new Date(Date.parse(input.now) - WEEK_MS).toISOString();
  const messagesById = new Map(
    input.messages.map((message) => [message.messageId, message])
  );

  return {
    period: {
      fromInclusive,
      toExclusive: input.now
    },
    stats: buildWeeklyStats(input.messages),
    participantStats: buildWeeklyParticipantStats(input.messages),
    selectedEvents: input.selectedEvents.map((event) => {
      const messages = event.messageIds
        .map((messageId) => messagesById.get(messageId))
        .filter((message): message is WeeklyMessage => message !== undefined);
      const excerptMessages = selectWeeklyEventExcerpts(messages);

      return {
        ...event,
        messages,
        excerptMessages,
        omittedMessageCount: Math.max(0, messages.length - excerptMessages.length)
      };
    })
  };
}

function selectWeeklyEventExcerpts(messages: WeeklyMessage[]): WeeklyMessage[] {
  const ordered = [...messages].sort(compareWeeklyMessages);

  if (ordered.length <= WEEKLY_EVENT_EXCERPT_LIMIT) {
    return ordered;
  }

  const selected = new Map<number, WeeklyMessage>();
  const add = (message: WeeklyMessage | undefined) => {
    if (message) {
      selected.set(message.messageId, message);
    }
  };

  add(ordered[0]);
  add(ordered[1]);
  add(ordered.at(-2));
  add(ordered.at(-1));

  for (const message of [...ordered].sort(compareExcerptPriority)) {
    add(message);

    if (selected.size >= WEEKLY_EVENT_EXCERPT_LIMIT) {
      break;
    }
  }

  return [...selected.values()].sort(compareWeeklyMessages);
}

function compareExcerptPriority(
  left: WeeklyMessage,
  right: WeeklyMessage
): number {
  return (
    scoreExcerptMessage(right) - scoreExcerptMessage(left) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.messageId - right.messageId
  );
}

function scoreExcerptMessage(message: WeeklyMessage): number {
  let score = 0;

  if (message.mediaSummary) {
    score += 5;
  }

  if (message.mediaSnapshot) {
    score += 2;
  }

  if (message.replyToMessageId !== null) {
    score += 3;
  }

  if (message.text.trim().length > 0) {
    score += 1;
  }

  return score;
}

function compareWeeklyMessages(left: WeeklyMessage, right: WeeklyMessage): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.messageId - right.messageId
  );
}

function buildWeeklyParticipantStats(
  messages: WeeklyMessage[]
): WeeklyParticipantStats[] {
  const byUser = new Map<
    string,
    WeeklyParticipantStats & { firstMessageId: number }
  >();

  for (const message of messages) {
    const key =
      message.userId === null ? `unknown:${message.senderDisplayName}` : `${message.userId}`;
    const existing = byUser.get(key);

    if (existing) {
      existing.messageCount += 1;
      existing.firstMessageId = Math.min(existing.firstMessageId, message.messageId);
      continue;
    }

    byUser.set(key, {
      userId: message.userId,
      displayName: message.senderDisplayName,
      messageCount: 1,
      firstMessageId: message.messageId
    });
  }

  return [...byUser.values()]
    .sort(
      (left, right) =>
        right.messageCount - left.messageCount ||
        left.displayName.localeCompare(right.displayName) ||
        left.firstMessageId - right.firstMessageId
    )
    .map(({ firstMessageId: _firstMessageId, ...participant }) => participant);
}
