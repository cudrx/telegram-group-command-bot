import type Database from 'better-sqlite3';
import type { SaveMemePostInput } from './types.js';

export function saveMemePost(
  db: Database.Database,
  input: SaveMemePostInput
): void {
  db.prepare(
    `
      INSERT INTO meme_posts (
        reddit_post_id,
        subreddit,
        chat_id,
        telegram_message_id,
        title,
        permalink,
        media_kind,
        media_url,
        upvotes,
        sent_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id, reddit_post_id) DO UPDATE SET
        telegram_message_id = excluded.telegram_message_id,
        title = excluded.title,
        permalink = excluded.permalink,
        media_kind = excluded.media_kind,
        media_url = excluded.media_url,
        upvotes = excluded.upvotes,
        sent_at = excluded.sent_at
    `
  ).run(
    input.redditPostId,
    input.subreddit,
    input.chatId,
    input.telegramMessageId,
    input.title,
    input.permalink,
    input.mediaKind,
    input.mediaUrl,
    input.upvotes,
    input.sentAt
  );
}

export function getRecentMemePostIds(
  db: Database.Database,
  input: {
    chatId: number;
    redditPostIds: string[];
    since: string;
  }
): Set<string> {
  if (input.redditPostIds.length === 0) {
    return new Set();
  }

  const placeholders = input.redditPostIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `
        SELECT reddit_post_id AS redditPostId
        FROM meme_posts
        WHERE chat_id = ?
          AND sent_at >= ?
          AND reddit_post_id IN (${placeholders})
      `
    )
    .all(input.chatId, input.since, ...input.redditPostIds) as Array<{
    redditPostId: string;
  }>;

  return new Set(rows.map((row) => row.redditPostId));
}
