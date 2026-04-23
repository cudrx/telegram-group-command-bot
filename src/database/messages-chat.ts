import type Database from 'better-sqlite3';

import type { ChatState } from '../domain/models.js';

export function getChatState(
  db: Database.Database,
  chatId: number
): ChatState | null {
  const row = db
    .prepare(
      `
        SELECT
          chat_id AS chatId,
          chat_type AS chatType,
          title,
          last_message_at AS lastMessageAt,
          last_bot_message_at AS lastBotMessageAt
        FROM chats
        WHERE chat_id = ?
      `
    )
    .get(chatId) as ChatState | undefined;

  return row ?? null;
}

export function upsertChat(
  db: Database.Database,
  input: {
    chatId: number;
    chatType: string;
    title: string | null;
    lastMessageAt: string;
    lastBotMessageAt: string | null;
  }
): void {
  db.prepare(
    `
      INSERT INTO chats (chat_id, chat_type, title, last_message_at, last_bot_message_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        chat_type = excluded.chat_type,
        title = excluded.title,
        last_message_at = excluded.last_message_at,
        last_bot_message_at = COALESCE(excluded.last_bot_message_at, chats.last_bot_message_at)
    `
  ).run(
    input.chatId,
    input.chatType,
    input.title,
    input.lastMessageAt,
    input.lastBotMessageAt
  );
}
