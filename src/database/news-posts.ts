import type Database from 'better-sqlite3';
import type { NewsPostRecord } from './types.js';

export function saveNewsPosts(
  db: Database.Database,
  posts: NewsPostRecord[]
): void {
  if (posts.length === 0) return;

  const insert = db.prepare(
    `
      INSERT INTO news_posts (
        source_slug,
        message_id,
        published_at,
        fetched_at,
        text,
        url,
        content_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_slug, message_id) DO UPDATE SET
        published_at = excluded.published_at,
        fetched_at = excluded.fetched_at,
        text = excluded.text,
        url = excluded.url,
        content_hash = excluded.content_hash
    `
  );
  const transaction = db.transaction((records: NewsPostRecord[]) => {
    for (const post of records) {
      insert.run(
        post.sourceSlug,
        post.messageId,
        post.publishedAt,
        post.fetchedAt,
        post.text,
        post.url,
        post.contentHash
      );
    }
  });

  transaction(posts);
}

export function getNewsPosts(
  db: Database.Database,
  input: {
    sourceSlugs: string[];
    since: string;
  }
): NewsPostRecord[] {
  if (input.sourceSlugs.length === 0) return [];

  const placeholders = input.sourceSlugs.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `
        SELECT
          source_slug AS sourceSlug,
          message_id AS messageId,
          published_at AS publishedAt,
          fetched_at AS fetchedAt,
          text,
          url,
          content_hash AS contentHash
        FROM news_posts
        WHERE source_slug IN (${placeholders})
          AND published_at >= ?
        ORDER BY published_at ASC, message_id ASC
      `
    )
    .all(...input.sourceSlugs, input.since) as NewsPostRecord[];

  return rows;
}
