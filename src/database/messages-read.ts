import type Database from 'better-sqlite3';

import { toStoredMessage } from './rows.js';
import type { StoredMessage, StoredMessageRow } from './types.js';

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
          media_caption AS mediaCaption,
          media_group_id AS mediaGroupId
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
          media_caption AS mediaCaption,
          media_group_id AS mediaGroupId
        FROM messages
        WHERE chat_id = ? AND telegram_message_id < ?
        ORDER BY telegram_message_id DESC
        LIMIT ?
      `
    )
    .all(chatId, beforeMessageId, limit) as StoredMessageRow[];

  return rows.reverse().map(toStoredMessage);
}

export function getMessagesInRange(
  db: Database.Database,
  input: {
    chatId: number;
    fromInclusive: string;
    toExclusive: string;
  }
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
          media_caption AS mediaCaption,
          media_group_id AS mediaGroupId
        FROM messages
        WHERE chat_id = ?
          AND created_at >= ?
          AND created_at < ?
        ORDER BY telegram_message_id ASC
      `
    )
    .all(
      input.chatId,
      input.fromInclusive,
      input.toExclusive
    ) as StoredMessageRow[];

  return rows.map(toStoredMessage);
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
          media_caption AS mediaCaption,
          media_group_id AS mediaGroupId
        FROM messages
        WHERE chat_id = ? AND telegram_message_id = ?
      `
    )
    .get(chatId, messageId) as StoredMessageRow | undefined;

  return row ? toStoredMessage(row) : null;
}
