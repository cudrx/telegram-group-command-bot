import type Database from 'better-sqlite3';

export function cleanupExpiredData(
  db: Database.Database,
  input: {
    now: string;
    messageRetentionDays: number;
    mediaArtifactRetentionDays: number;
  }
): { mediaArtifacts: number; messages: number; chats: number } {
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

    const chats = db
      .prepare(
        `
          DELETE FROM chats
          WHERE chat_id NOT IN (SELECT DISTINCT chat_id FROM messages)
            AND chat_id NOT IN (SELECT DISTINCT chat_id FROM media_artifacts)
        `
      )
      .run().changes;

    return { mediaArtifacts, messages, chats };
  });

  return transaction(input);
}
