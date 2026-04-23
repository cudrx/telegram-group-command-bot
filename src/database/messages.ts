import type Database from 'better-sqlite3';

import type { ChatState } from '../domain/models.js';
import { toStoredMessage } from './rows.js';
import type {
  NormalizedMessage,
  StoredMessage,
  StoredMessageRow
} from './types.js';

type SaveBotMessageInput = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  messageId: number;
  text: string;
  createdAt: string;
  userId: number;
  username: string | null;
  displayName: string;
  replyToMessageId?: number | null;
};

export function saveIncomingMessage(
  db: Database.Database,
  message: NormalizedMessage
): boolean {
  const transaction = db.transaction((incoming: NormalizedMessage) => {
    upsertChat(db, {
      chatId: incoming.chatId,
      chatType: incoming.chatType,
      title: incoming.chatTitle,
      lastMessageAt: incoming.createdAt,
      lastBotMessageAt: null
    });

    const result = db
      .prepare(
        `
          INSERT OR IGNORE INTO messages (
            chat_id,
            telegram_message_id,
            user_id,
            sender_display_name,
            text,
            created_at,
            is_bot,
            reply_to_telegram_message_id,
            media_kind,
            media_file_id,
            media_file_unique_id,
            media_mime_type,
            media_file_size,
            media_duration_seconds,
            media_caption,
            from_user_id,
            from_username,
            from_first_name,
            from_last_name,
            from_display_name
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        incoming.chatId,
        incoming.messageId,
        incoming.fromUserId,
        incoming.fromDisplayName,
        incoming.text,
        incoming.createdAt,
        incoming.isBot ? 1 : 0,
        incoming.replyToMessageId,
        incoming.mediaSnapshot?.mediaKind ?? null,
        incoming.mediaSnapshot?.fileId ?? null,
        incoming.mediaSnapshot?.fileUniqueId ?? null,
        incoming.mediaSnapshot?.mimeType ?? null,
        incoming.mediaSnapshot?.fileSize ?? null,
        incoming.mediaSnapshot?.durationSeconds ?? null,
        incoming.mediaSnapshot?.caption ?? null,
        incoming.fromUserId,
        incoming.fromUsername,
        incoming.fromFirstName,
        incoming.fromLastName,
        incoming.fromDisplayName
      );

    if (result.changes > 0) {
      db.prepare(`UPDATE chats SET last_message_at = ? WHERE chat_id = ?`).run(
        incoming.createdAt,
        incoming.chatId
      );
    }

    return result.changes > 0;
  });

  return transaction(message);
}

export function saveBotMessage(
  db: Database.Database,
  input: SaveBotMessageInput
): void {
  const transaction = db.transaction((outgoing: SaveBotMessageInput) => {
    upsertChat(db, {
      chatId: outgoing.chatId,
      chatType: outgoing.chatType,
      title: outgoing.chatTitle,
      lastMessageAt: outgoing.createdAt,
      lastBotMessageAt: outgoing.createdAt
    });

    const result = db
      .prepare(
        `
          INSERT OR IGNORE INTO messages (
            chat_id,
            telegram_message_id,
            user_id,
            sender_display_name,
            text,
            created_at,
            is_bot,
            reply_to_telegram_message_id,
            media_kind,
            media_file_id,
            media_file_unique_id,
            media_mime_type,
            media_file_size,
            media_duration_seconds,
            media_caption,
            from_user_id,
            from_username,
            from_first_name,
            from_last_name,
            from_display_name
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        outgoing.chatId,
        outgoing.messageId,
        outgoing.userId,
        outgoing.displayName,
        outgoing.text,
        outgoing.createdAt,
        1,
        outgoing.replyToMessageId ?? null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        outgoing.userId,
        outgoing.username,
        null,
        null,
        outgoing.displayName
      );

    if (result.changes > 0) {
      db.prepare(
        `
          UPDATE chats
          SET last_message_at = ?, last_bot_message_at = ?
          WHERE chat_id = ?
        `
      ).run(outgoing.createdAt, outgoing.createdAt, outgoing.chatId);
    }
  });

  transaction(input);
}

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

export function getRecentMessages(
  db: Database.Database,
  chatId: number,
  limit: number
): StoredMessage[] {
  const rows = db
    .prepare(
      `
        SELECT
          chat_id AS chatId,
          telegram_message_id AS messageId,
          user_id AS userId,
          sender_display_name AS senderDisplayName,
          text,
          created_at AS createdAt,
          is_bot AS isBot,
          reply_to_telegram_message_id AS replyToMessageId,
          media_kind AS mediaKind,
          media_file_id AS mediaFileId,
          media_file_unique_id AS mediaFileUniqueId,
          media_mime_type AS mediaMimeType,
          media_file_size AS mediaFileSize,
          media_duration_seconds AS mediaDurationSeconds,
          media_caption AS mediaCaption
        FROM messages
        WHERE chat_id = ?
        ORDER BY telegram_message_id DESC
        LIMIT ?
      `
    )
    .all(chatId, limit) as StoredMessageRow[];

  return rows.reverse().map(toStoredMessage);
}

export function getMessagesBefore(
  db: Database.Database,
  chatId: number,
  beforeMessageId: number,
  limit: number
): StoredMessage[] {
  const rows = db
    .prepare(
      `
        SELECT
          chat_id AS chatId,
          telegram_message_id AS messageId,
          user_id AS userId,
          sender_display_name AS senderDisplayName,
          text,
          created_at AS createdAt,
          is_bot AS isBot,
          reply_to_telegram_message_id AS replyToMessageId,
          media_kind AS mediaKind,
          media_file_id AS mediaFileId,
          media_file_unique_id AS mediaFileUniqueId,
          media_mime_type AS mediaMimeType,
          media_file_size AS mediaFileSize,
          media_duration_seconds AS mediaDurationSeconds,
          media_caption AS mediaCaption
        FROM messages
        WHERE chat_id = ? AND telegram_message_id < ?
        ORDER BY telegram_message_id DESC
        LIMIT ?
      `
    )
    .all(chatId, beforeMessageId, limit) as StoredMessageRow[];

  return rows.reverse().map(toStoredMessage);
}

export function getMessageByTelegramMessageId(
  db: Database.Database,
  chatId: number,
  messageId: number
): StoredMessage | null {
  const row = db
    .prepare(
      `
        SELECT
          chat_id AS chatId,
          telegram_message_id AS messageId,
          user_id AS userId,
          sender_display_name AS senderDisplayName,
          text,
          created_at AS createdAt,
          is_bot AS isBot,
          reply_to_telegram_message_id AS replyToMessageId,
          media_kind AS mediaKind,
          media_file_id AS mediaFileId,
          media_file_unique_id AS mediaFileUniqueId,
          media_mime_type AS mediaMimeType,
          media_file_size AS mediaFileSize,
          media_duration_seconds AS mediaDurationSeconds,
          media_caption AS mediaCaption
        FROM messages
        WHERE chat_id = ? AND telegram_message_id = ?
      `
    )
    .get(chatId, messageId) as StoredMessageRow | undefined;

  return row ? toStoredMessage(row) : null;
}

function upsertChat(
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
