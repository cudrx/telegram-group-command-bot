import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { ChatState, NormalizedMessage, StoredMessage } from "../domain/models.js";

const schema = `
CREATE TABLE IF NOT EXISTS chats (
  chat_id INTEGER PRIMARY KEY,
  chat_type TEXT NOT NULL,
  title TEXT,
  last_message_at TEXT,
  last_bot_message_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  user_id INTEGER,
  sender_display_name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0,
  reply_to_telegram_message_id INTEGER,
  from_user_id INTEGER,
  from_username TEXT,
  from_first_name TEXT,
  from_last_name TEXT,
  from_display_name TEXT,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE,
  UNIQUE (chat_id, telegram_message_id)
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created_at
  ON messages(chat_id, created_at);
`;

export class DatabaseClient {
  private constructor(private readonly db: Database.Database) {}

  static open(filename: string): DatabaseClient {
    const directory = path.dirname(filename);

    if (directory !== ".") {
      mkdirSync(directory, { recursive: true });
    }

    let db: Database.Database;

    try {
      db = new Database(filename);
    } catch (error) {
      throw normalizeDatabaseOpenError(error, filename);
    }

    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(schema);
    migrateExistingSchema(db);

    return new DatabaseClient(db);
  }

  saveIncomingMessage(message: NormalizedMessage): boolean {
    const transaction = this.db.transaction((incoming: NormalizedMessage) => {
      upsertChat(this.db, {
        chatId: incoming.chatId,
        chatType: incoming.chatType,
        title: incoming.chatTitle,
        lastMessageAt: incoming.createdAt,
        lastBotMessageAt: null
      });

      const result = this.db
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
              from_user_id,
              from_username,
              from_first_name,
              from_last_name,
              from_display_name
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          incoming.fromUserId,
          incoming.fromUsername,
          incoming.fromFirstName,
          incoming.fromLastName,
          incoming.fromDisplayName
        );

      if (result.changes > 0) {
        this.db
          .prepare(`UPDATE chats SET last_message_at = ? WHERE chat_id = ?`)
          .run(incoming.createdAt, incoming.chatId);
      }

      return result.changes > 0;
    });

    return transaction(message);
  }

  saveBotMessage(input: {
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
  }): void {
    const transaction = this.db.transaction(
      (outgoing: {
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
      }) => {
        upsertChat(this.db, {
          chatId: outgoing.chatId,
          chatType: outgoing.chatType,
          title: outgoing.chatTitle,
          lastMessageAt: outgoing.createdAt,
          lastBotMessageAt: outgoing.createdAt
        });

        const result = this.db
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
                from_user_id,
                from_username,
                from_first_name,
                from_last_name,
                from_display_name
              )
              VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            outgoing.chatId,
            outgoing.messageId,
            outgoing.userId,
            outgoing.displayName,
            outgoing.text,
            outgoing.createdAt,
            outgoing.replyToMessageId ?? null,
            outgoing.userId,
            outgoing.username,
            null,
            null,
            outgoing.displayName
          );

        if (result.changes > 0) {
          this.db
            .prepare(
              `
                UPDATE chats
                SET last_message_at = ?, last_bot_message_at = ?
                WHERE chat_id = ?
              `
            )
            .run(outgoing.createdAt, outgoing.createdAt, outgoing.chatId);
        }
      }
    );

    transaction(input);
  }

  getChatState(chatId: number): ChatState | null {
    const row = this.db
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

  getRecentMessages(chatId: number, limit: number): StoredMessage[] {
    type StoredMessageRow = Omit<StoredMessage, "isBot"> & { isBot: number };

    const rows = this.db
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
            reply_to_telegram_message_id AS replyToMessageId
          FROM messages
          WHERE chat_id = ?
          ORDER BY telegram_message_id DESC
          LIMIT ?
        `
      )
      .all(chatId, limit) as StoredMessageRow[];

    return rows.reverse().map(toStoredMessage);
  }

  getMessagesBefore(
    chatId: number,
    beforeMessageId: number,
    limit: number
  ): StoredMessage[] {
    type StoredMessageRow = Omit<StoredMessage, "isBot"> & { isBot: number };

    const rows = this.db
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
            reply_to_telegram_message_id AS replyToMessageId
          FROM messages
          WHERE chat_id = ? AND telegram_message_id < ?
          ORDER BY telegram_message_id DESC
          LIMIT ?
        `
      )
      .all(chatId, beforeMessageId, limit) as StoredMessageRow[];

    return rows.reverse().map(toStoredMessage);
  }

  getMessageByTelegramMessageId(chatId: number, messageId: number): StoredMessage | null {
    const row = this.db
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
            reply_to_telegram_message_id AS replyToMessageId
          FROM messages
          WHERE chat_id = ? AND telegram_message_id = ?
        `
      )
      .get(chatId, messageId) as
      | (Omit<StoredMessage, "isBot"> & { isBot: number })
      | undefined;

    return row ? toStoredMessage(row) : null;
  }

  getAppState(key: string): string | null {
    const row = this.db
      .prepare(`SELECT value FROM app_state WHERE key = ?`)
      .get(key) as { value: string } | undefined;

    return row?.value ?? null;
  }

  setAppState(key: string, value: string, updatedAt: string): void {
    this.db
      .prepare(
        `
          INSERT INTO app_state (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `
      )
      .run(key, value, updatedAt);
  }

  getSchemaColumns(tableName: string): string[] {
    return (
      this.db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all() as Array<{ name: string }>
    ).map((column) => column.name);
  }

  close(): void {
    this.db.close();
  }
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

function toStoredMessage(
  row: Omit<StoredMessage, "isBot"> & { isBot: number }
): StoredMessage {
  return {
    ...row,
    isBot: Boolean(row.isBot)
  };
}

function migrateExistingSchema(db: Database.Database): void {
  ensureColumn(db, "messages", "from_user_id", "INTEGER");
  ensureColumn(db, "messages", "from_username", "TEXT");
  ensureColumn(db, "messages", "from_first_name", "TEXT");
  ensureColumn(db, "messages", "from_last_name", "TEXT");
  ensureColumn(db, "messages", "from_display_name", "TEXT");
}

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void {
  const columns = (
    db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  ).map((column) => column.name);

  if (!columns.includes(columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
}

function normalizeDatabaseOpenError(error: unknown, filename: string): Error {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "SQLITE_CANTOPEN"
  ) {
    return new Error(`Could not open SQLite database at ${filename}`);
  }

  return error instanceof Error ? error : new Error(String(error));
}
