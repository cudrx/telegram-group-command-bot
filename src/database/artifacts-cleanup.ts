import type Database from 'better-sqlite3';

export function cleanupExpiredData(
  db: Database.Database,
  input: {
    now: string;
    messageRetentionDays: number;
    mediaArtifactRetentionDays: number;
    memeHistoryRetentionDays: number;
    newsPostRetentionDays?: number;
  }
): {
  mediaArtifacts: number;
  messages: number;
  chats: number;
  memePosts: number;
  newsPosts: number;
} {
  const transaction = db.transaction((cleanupInput: typeof input) => {
    const mediaArtifactCutoff = new Date(
      new Date(cleanupInput.now).getTime() -
        cleanupInput.mediaArtifactRetentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const mediaArtifacts = db
      .prepare(
        `
          DELETE FROM media_artifacts
          WHERE expires_at < ? OR created_at < ?
        `
      )
      .run(cleanupInput.now, mediaArtifactCutoff).changes;

    const messageCutoff = new Date(
      new Date(cleanupInput.now).getTime() -
        cleanupInput.messageRetentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const messages = db
      .prepare(`DELETE FROM messages WHERE created_at < ?`)
      .run(messageCutoff).changes;

    const memePostCutoff = new Date(
      new Date(cleanupInput.now).getTime() -
        cleanupInput.memeHistoryRetentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const memePosts = db
      .prepare(`DELETE FROM meme_posts WHERE sent_at < ?`)
      .run(memePostCutoff).changes;

    const newsPostRetentionDays =
      cleanupInput.newsPostRetentionDays ??
      cleanupInput.memeHistoryRetentionDays;
    const newsPostCutoff = new Date(
      new Date(cleanupInput.now).getTime() -
        newsPostRetentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const newsPosts = db
      .prepare(`DELETE FROM news_posts WHERE published_at < ?`)
      .run(newsPostCutoff).changes;

    const chats = db
      .prepare(
        `
          DELETE FROM chats
          WHERE chat_id NOT IN (SELECT DISTINCT chat_id FROM messages)
            AND chat_id NOT IN (SELECT DISTINCT chat_id FROM media_artifacts)
            AND chat_id NOT IN (SELECT DISTINCT chat_id FROM meme_posts)
        `
      )
      .run().changes;

    return { mediaArtifacts, messages, chats, memePosts, newsPosts };
  });

  return transaction(input);
}
