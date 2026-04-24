import { sanitizePromptText } from '../../llm/prompts/sanitize.js';
import { formatWeeklyMessageLine } from './media.js';
import type { WeeklyDataset, WeeklyDatasetEvent } from './types.js';

export function formatWeeklyDataset(input: WeeklyDataset): string {
  return [
    'WEEK_STATS',
    formatWeekStats(input),
    '',
    'PARTICIPANT_STATS',
    formatParticipantStats(input),
    '',
    'SELECTED_EVENTS',
    formatSelectedEvents(input.selectedEvents)
  ].join('\n');
}

function formatWeekStats(input: WeeklyDataset): string {
  return [
    `period=${input.period.fromInclusive}..${input.period.toExclusive}`,
    `totalHumanMessages=${input.stats.totalHumanMessages}`,
    `participants=${input.stats.participants}`,
    `replyMessages=${input.stats.replyMessages}`,
    `mediaMessages=${input.stats.mediaMessages}`,
    `mediaMessagesWithSuccessfulSummaries=${input.stats.mediaMessagesWithSuccessfulSummaries}`,
    `topActiveDays=${formatTopActiveDays(input.stats.topActiveDays)}`
  ].join('\n');
}

function formatParticipantStats(input: WeeklyDataset): string {
  if (input.participantStats.length === 0) {
    return 'none';
  }

  return [...input.participantStats]
    .sort(
      (left, right) =>
        right.messageCount - left.messageCount ||
        sanitizePromptText(left.displayName).localeCompare(
          sanitizePromptText(right.displayName)
        ) ||
        (left.userId ?? Number.MAX_SAFE_INTEGER) -
          (right.userId ?? Number.MAX_SAFE_INTEGER)
    )
    .map(
      (participant) =>
        `- userId=${participant.userId ?? 'unknown'} displayName="${sanitizePromptText(
          participant.displayName
        )}" messageCount=${participant.messageCount}`
    )
    .join('\n');
}

function formatSelectedEvents(events: WeeklyDatasetEvent[]): string {
  if (events.length === 0) {
    return 'none';
  }

  return [...events]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.startAt.localeCompare(right.startAt) ||
        left.id.localeCompare(right.id)
    )
    .map(formatEvent)
    .join('\n');
}

function formatEvent(event: WeeklyDatasetEvent, index: number): string {
  const lines = [
    `${index + 1}. id=${event.id}`,
    `   kinds=${event.kinds.join(',')}`,
    `   time=${event.startAt}..${event.endAt}`,
    `   score=${event.score}`,
    `   messageIds=${event.messageIds.join(',')}`,
    `   participantIds=${event.participantIds.join(',')}`,
    `   reasons=${event.reasons.map(sanitizePromptText).join('; ') || 'none'}`,
    `   messageCount=${event.messages.length}`,
    `   omittedMessages=${event.omittedMessageCount}`,
    '   evidence:'
  ];

  for (const message of [...event.excerptMessages].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.messageId - right.messageId
  )) {
    lines.push(`   - ${sanitizePromptText(formatWeeklyMessageLine(message))}`);
  }

  return lines.join('\n');
}

function formatTopActiveDays(days: Array<[string, number]>): string {
  if (days.length === 0) {
    return 'none';
  }

  return days
    .map(([day, count]) => `${sanitizePromptText(day)}:${count}`)
    .join(',');
}
