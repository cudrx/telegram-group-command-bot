import type Database from 'better-sqlite3';
import { upsertChat } from './messages-chat.js';
import type { NormalizedMessage } from './types.js';

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
            media_group_id,
            from_user_id,
            from_username,
            from_first_name,
            from_last_name,
            from_display_name
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        incoming.mediaGroupId ?? null,
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
            media_group_id,
            from_user_id,
            from_username,
            from_first_name,
            from_last_name,
            from_display_name
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
