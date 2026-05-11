import { weeklyActionConfig } from '../../config/runtime/index.js';
import type { WeeklyEventCandidate } from './types.js';

const MERGE_GAP_MS = weeklyActionConfig.selection.mergeGapMs;
const MAX_EVENTS = weeklyActionConfig.selection.maxEvents;
const MIN_EVENTS = weeklyActionConfig.selection.minEvents;
const MAX_EVENTS_PER_DAY = weeklyActionConfig.selection.maxEventsPerDay;

export function mergeWeeklyCandidates(
  candidates: WeeklyEventCandidate[]
): WeeklyEventCandidate[] {
  const merged: WeeklyEventCandidate[] = [];

  for (const candidate of [...candidates].sort(compareEvents)) {
    let next = normalizeCandidate(candidate);
    let didMerge = true;

    while (didMerge) {
      didMerge = false;

      for (let index = 0; index < merged.length; index += 1) {
        const existing = merged[index];

        if (!existing || !shouldMerge(existing, next)) {
          continue;
        }

        next = mergePair(existing, next);
        merged.splice(index, 1);
        didMerge = true;
        break;
      }
    }

    merged.push(next);
  }

  return merged.sort(compareEvents);
}

export function selectWeeklyEvents(
  candidates: WeeklyEventCandidate[]
): WeeklyEventCandidate[] {
  const ranked = mergeWeeklyCandidates(candidates).sort(compareRank);
  const selected: WeeklyEventCandidate[] = [];
  const selectedIds = new Set<string>();
  const dayCounts = new Map<string, number>();

  for (const event of ranked) {
    if (selected.length >= MAX_EVENTS) {
      break;
    }

    const day = event.startAt.slice(0, 10);
    const dayCount = dayCounts.get(day) ?? 0;

    if (dayCount >= MAX_EVENTS_PER_DAY) {
      continue;
    }

    selected.push(event);
    selectedIds.add(event.id);
    dayCounts.set(day, dayCount + 1);
  }

  if (selected.length < MIN_EVENTS) {
    for (const event of ranked) {
      if (selected.length >= MIN_EVENTS || selected.length >= MAX_EVENTS) {
        break;
      }

      if (selectedIds.has(event.id)) {
        continue;
      }

      selected.push(event);
      selectedIds.add(event.id);
    }
  }

  return selected;
}

function shouldMerge(
  left: WeeklyEventCandidate,
  right: WeeklyEventCandidate
): boolean {
  return (
    hasOverlap(left.messageIds, right.messageIds) ||
    timeWindowsOverlap(left, right) ||
    (gapMs(left, right) < MERGE_GAP_MS &&
      hasOverlap(left.participantIds, right.participantIds))
  );
}

function mergePair(
  left: WeeklyEventCandidate,
  right: WeeklyEventCandidate
): WeeklyEventCandidate {
  const kinds = uniqueStrings([...left.kinds, ...right.kinds]);
  const messageIds = uniqueNumbers([...left.messageIds, ...right.messageIds]);
  const participantIds = uniqueNumbers([
    ...left.participantIds,
    ...right.participantIds
  ]);
  const startAt = minIso(left.startAt, right.startAt);
  const endAt = maxIso(left.endAt, right.endAt);
  const reasons = uniqueStrings([...left.reasons, ...right.reasons]);

  return {
    id: `${kinds.join('+')}:${messageIds[0] ?? 'none'}-${messageIds.at(-1) ?? 'none'}`,
    kinds,
    startAt,
    endAt,
    messageIds,
    participantIds,
    score: left.score + right.score,
    reasons
  };
}

function normalizeCandidate(
  candidate: WeeklyEventCandidate
): WeeklyEventCandidate {
  const kinds = uniqueStrings(candidate.kinds);
  const messageIds = uniqueNumbers(candidate.messageIds);
  const participantIds = uniqueNumbers(candidate.participantIds);

  return {
    ...candidate,
    id:
      candidate.id ||
      `${kinds.join('+')}:${messageIds[0] ?? 'none'}-${messageIds.at(-1) ?? 'none'}`,
    kinds,
    messageIds,
    participantIds,
    reasons: uniqueStrings(candidate.reasons)
  };
}

function timeWindowsOverlap(
  left: WeeklyEventCandidate,
  right: WeeklyEventCandidate
): boolean {
  return (
    Date.parse(left.startAt) <= Date.parse(right.endAt) &&
    Date.parse(right.startAt) <= Date.parse(left.endAt)
  );
}

function gapMs(
  left: WeeklyEventCandidate,
  right: WeeklyEventCandidate
): number {
  if (timeWindowsOverlap(left, right)) {
    return 0;
  }

  const leftEnd = Date.parse(left.endAt);
  const rightStart = Date.parse(right.startAt);
  const rightEnd = Date.parse(right.endAt);
  const leftStart = Date.parse(left.startAt);

  return Math.min(
    Math.abs(rightStart - leftEnd),
    Math.abs(leftStart - rightEnd)
  );
}

function hasOverlap(left: number[], right: number[]): boolean {
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value));
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function minIso(left: string, right: string): string {
  return left <= right ? left : right;
}

function maxIso(left: string, right: string): string {
  return left >= right ? left : right;
}

function compareRank(
  left: WeeklyEventCandidate,
  right: WeeklyEventCandidate
): number {
  return (
    right.score - left.score ||
    left.startAt.localeCompare(right.startAt) ||
    left.endAt.localeCompare(right.endAt) ||
    (left.messageIds[0] ?? 0) - (right.messageIds[0] ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

function compareEvents(
  left: WeeklyEventCandidate,
  right: WeeklyEventCandidate
): number {
  return (
    left.startAt.localeCompare(right.startAt) ||
    left.endAt.localeCompare(right.endAt) ||
    (left.messageIds[0] ?? 0) - (right.messageIds[0] ?? 0) ||
    left.id.localeCompare(right.id)
  );
}
