import { sanitizePromptText } from '../../llm/prompts/sanitize.js';
import { formatWeeklyMessageLine } from './media.js';
import type { WeeklyDataset, WeeklyDatasetEvent } from './types.js';

type ActivityTier = 'high' | 'medium' | 'low';

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

  const maxMessageCount = Math.max(
    ...input.participantStats.map((participant) => participant.messageCount)
  );

  return input.participantStats
    .map((participant) => ({
      displayName: sanitizePromptText(participant.displayName),
      activityTier: getActivityTier(participant.messageCount, maxMessageCount)
    }))
    .sort(
      (left, right) =>
        compareActivityTier(left.activityTier, right.activityTier) ||
        left.displayName.localeCompare(right.displayName)
    )
    .map(
      (participant) =>
        `- displayName="${participant.displayName}" activityTier=${participant.activityTier}`
    )
    .join('\n');
}

function getActivityTier(
  messageCount: number,
  maxMessageCount: number
): ActivityTier {
  if (maxMessageCount <= 0) {
    return 'low';
  }

  const ratio = messageCount / maxMessageCount;

  if (ratio >= 0.6) {
    return 'high';
  }

  if (ratio >= 0.25) {
    return 'medium';
  }

  return 'low';
}

function compareActivityTier(left: ActivityTier, right: ActivityTier): number {
  const rank: Record<ActivityTier, number> = {
    high: 0,
    medium: 1,
    low: 2
  };

  return rank[left] - rank[right];
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
    `${index + 1}. event`,
    `   kinds=${event.kinds.join(',')}`,
    `   time=${event.startAt}..${event.endAt}`,
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
    .map(([day]) => sanitizePromptText(day))
    .join(',');
}
