import type { DatabaseClient } from '../../../database/index.js';

export function getMemeHistorySince(input: {
  now: string;
  retentionDays: number;
}): string {
  return new Date(
    new Date(input.now).getTime() - input.retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();
}

export function getRecentlySentMemeIds(input: {
  db: DatabaseClient;
  chatId: number;
  redditPostIds: string[];
  now: string;
  retentionDays: number;
}): Set<string> {
  return input.db.getRecentMemePostIds({
    chatId: input.chatId,
    redditPostIds: input.redditPostIds,
    since: getMemeHistorySince({
      now: input.now,
      retentionDays: input.retentionDays
    })
  });
}
