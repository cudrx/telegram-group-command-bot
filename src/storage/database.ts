import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import type {
  ChatState,
  MediaMessageSnapshot,
  NormalizedMessage,
  StoredMessage
} from '../domain/models.js';

export type MediaArtifactStatus = 'success' | 'failed' | 'partial';

export type SaveMediaArtifactInput = {
  fileUniqueId: string | null;
  chatId: number;
  telegramMessageId: number;
  mediaKind: string;
  provider: string;
  providerModel: string;
  artifactKind: string;
  artifactStatus: MediaArtifactStatus;
  artifactText: string | null;
  artifactJson: unknown;
  rawResponseJson: unknown;
  sourceCaption: string | null;
  sourceMimeType: string | null;
  sourceFileSize: number | null;
  sourceDurationSeconds: number | null;
  recognitionLanguage: string | null;
  confidenceJson: unknown;
  errorText: string | null;
  createdAt: string;
  expiresAt: string;
};

export type StoredMediaArtifact = {
  id: number;
  fileUniqueId: string | null;
  chatId: number;
  telegramMessageId: number;
  mediaKind: string;
  provider: string;
  providerModel: string;
  artifactKind: string;
  artifactStatus: MediaArtifactStatus;
  artifactText: string | null;
  artifactJson: unknown;
  rawResponseJson: unknown;
  sourceCaption: string | null;
  sourceMimeType: string | null;
  sourceFileSize: number | null;
  sourceDurationSeconds: number | null;
  recognitionLanguage: string | null;
  confidenceJson: unknown;
  errorText: string | null;
  createdAt: string;
  expiresAt: string;
};

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
  media_kind TEXT,
  media_file_id TEXT,
  media_file_unique_id TEXT,
  media_mime_type TEXT,
  media_file_size INTEGER,
  media_duration_seconds REAL,
  media_caption TEXT,
  from_user_id INTEGER,
  from_username TEXT,
  from_first_name TEXT,
  from_last_name TEXT,
  from_display_name TEXT,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE,
  UNIQUE (chat_id, telegram_message_id)
);

CREATE TABLE IF NOT EXISTS media_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_unique_id TEXT,
  chat_id INTEGER NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  media_kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  artifact_status TEXT NOT NULL,
  artifact_text TEXT,
  artifact_json TEXT,
  raw_response_json TEXT,
  source_caption TEXT,
  source_mime_type TEXT,
  source_file_size INTEGER,
  source_duration_seconds REAL,
  recognition_language TEXT,
  confidence_json TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created_at
  ON messages(chat_id, created_at);

CREATE INDEX IF NOT EXISTS idx_media_artifacts_file_unique_provider
  ON media_artifacts(file_unique_id, provider, artifact_kind, artifact_status);

CREATE INDEX IF NOT EXISTS idx_media_artifacts_message_provider
  ON media_artifacts(chat_id, telegram_message_id, provider, artifact_kind, artifact_status);

CREATE INDEX IF NOT EXISTS idx_media_artifacts_expires_at
  ON media_artifacts(expires_at);
`;

export class DatabaseClient {
  private constructor(private readonly db: Database.Database) {}

  static open(filename: string): DatabaseClient {
    const directory = path.dirname(filename);

    if (directory !== '.') {
      mkdirSync(directory, { recursive: true });
    }

    let db: Database.Database;

    try {
      db = new Database(filename);
    } catch (error) {
      throw normalizeDatabaseOpenError(error, filename);
    }

    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
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
    type StoredMessageRow = Omit<StoredMessage, 'isBot'> & { isBot: number };

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

  getMessagesBefore(
    chatId: number,
    beforeMessageId: number,
    limit: number
  ): StoredMessage[] {
    type StoredMessageRow = Omit<StoredMessage, 'isBot'> & { isBot: number };

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

  getMessageByTelegramMessageId(
    chatId: number,
    messageId: number
  ): StoredMessage | null {
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
      .get(chatId, messageId) as
      | (Omit<StoredMessage, 'isBot'> & { isBot: number })
      | undefined;

    return row ? toStoredMessage(row) : null;
  }

  saveMediaArtifact(input: SaveMediaArtifactInput): void {
    this.db
      .prepare(
        `
          INSERT INTO media_artifacts (
            file_unique_id,
            chat_id,
            telegram_message_id,
            media_kind,
            provider,
            provider_model,
            artifact_kind,
            artifact_status,
            artifact_text,
            artifact_json,
            raw_response_json,
            source_caption,
            source_mime_type,
            source_file_size,
            source_duration_seconds,
            recognition_language,
            confidence_json,
            error_text,
            created_at,
            expires_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        input.fileUniqueId,
        input.chatId,
        input.telegramMessageId,
        input.mediaKind,
        input.provider,
        input.providerModel,
        input.artifactKind,
        input.artifactStatus,
        input.artifactText,
        stringifyJson(input.artifactJson),
        stringifyJson(input.rawResponseJson),
        input.sourceCaption,
        input.sourceMimeType,
        input.sourceFileSize,
        input.sourceDurationSeconds,
        input.recognitionLanguage,
        stringifyJson(input.confidenceJson),
        input.errorText,
        input.createdAt,
        input.expiresAt
      );
  }

  getSuccessfulMediaArtifact(input: {
    fileUniqueId: string | null;
    chatId: number;
    telegramMessageId: number;
    provider: string;
    artifactKind: string;
  }): StoredMediaArtifact | null {
    if (input.fileUniqueId) {
      const byFileUniqueId = getLatestSuccessfulMediaArtifactRow(
        this.db,
        `
          SELECT
            id,
            file_unique_id AS fileUniqueId,
            chat_id AS chatId,
            telegram_message_id AS telegramMessageId,
            media_kind AS mediaKind,
            provider,
            provider_model AS providerModel,
            artifact_kind AS artifactKind,
            artifact_status AS artifactStatus,
            artifact_text AS artifactText,
            artifact_json AS artifactJson,
            raw_response_json AS rawResponseJson,
            source_caption AS sourceCaption,
            source_mime_type AS sourceMimeType,
            source_file_size AS sourceFileSize,
            source_duration_seconds AS sourceDurationSeconds,
            recognition_language AS recognitionLanguage,
            confidence_json AS confidenceJson,
            error_text AS errorText,
            created_at AS createdAt,
            expires_at AS expiresAt
          FROM media_artifacts
          WHERE file_unique_id = ?
            AND provider = ?
            AND artifact_kind = ?
            AND artifact_status = 'success'
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [input.fileUniqueId, input.provider, input.artifactKind]
      );

      if (byFileUniqueId) {
        return byFileUniqueId;
      }
    }

    return getLatestSuccessfulMediaArtifactRow(
      this.db,
      `
        SELECT
          id,
          file_unique_id AS fileUniqueId,
          chat_id AS chatId,
          telegram_message_id AS telegramMessageId,
          media_kind AS mediaKind,
          provider,
          provider_model AS providerModel,
          artifact_kind AS artifactKind,
          artifact_status AS artifactStatus,
          artifact_text AS artifactText,
          artifact_json AS artifactJson,
          raw_response_json AS rawResponseJson,
          source_caption AS sourceCaption,
          source_mime_type AS sourceMimeType,
          source_file_size AS sourceFileSize,
          source_duration_seconds AS sourceDurationSeconds,
          recognition_language AS recognitionLanguage,
          confidence_json AS confidenceJson,
          error_text AS errorText,
          created_at AS createdAt,
          expires_at AS expiresAt
        FROM media_artifacts
        WHERE chat_id = ?
          AND telegram_message_id = ?
          AND provider = ?
          AND artifact_kind = ?
          AND artifact_status = 'success'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [
        input.chatId,
        input.telegramMessageId,
        input.provider,
        input.artifactKind
      ]
    );
  }

  getLatestMediaArtifact(input: {
    fileUniqueId: string | null;
    chatId: number;
    telegramMessageId: number;
    provider: string;
    artifactKind: string;
  }): StoredMediaArtifact | null {
    if (input.fileUniqueId) {
      const byFileUniqueId = getLatestMediaArtifactRow(
        this.db,
        `
          SELECT
            id,
            file_unique_id AS fileUniqueId,
            chat_id AS chatId,
            telegram_message_id AS telegramMessageId,
            media_kind AS mediaKind,
            provider,
            provider_model AS providerModel,
            artifact_kind AS artifactKind,
            artifact_status AS artifactStatus,
            artifact_text AS artifactText,
            artifact_json AS artifactJson,
            raw_response_json AS rawResponseJson,
            source_caption AS sourceCaption,
            source_mime_type AS sourceMimeType,
            source_file_size AS sourceFileSize,
            source_duration_seconds AS sourceDurationSeconds,
            recognition_language AS recognitionLanguage,
            confidence_json AS confidenceJson,
            error_text AS errorText,
            created_at AS createdAt,
            expires_at AS expiresAt
          FROM media_artifacts
          WHERE file_unique_id = ?
            AND provider = ?
            AND artifact_kind = ?
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [input.fileUniqueId, input.provider, input.artifactKind]
      );

      if (byFileUniqueId) {
        return byFileUniqueId;
      }
    }

    return getLatestMediaArtifactRow(
      this.db,
      `
        SELECT
          id,
          file_unique_id AS fileUniqueId,
          chat_id AS chatId,
          telegram_message_id AS telegramMessageId,
          media_kind AS mediaKind,
          provider,
          provider_model AS providerModel,
          artifact_kind AS artifactKind,
          artifact_status AS artifactStatus,
          artifact_text AS artifactText,
          artifact_json AS artifactJson,
          raw_response_json AS rawResponseJson,
          source_caption AS sourceCaption,
          source_mime_type AS sourceMimeType,
          source_file_size AS sourceFileSize,
          source_duration_seconds AS sourceDurationSeconds,
          recognition_language AS recognitionLanguage,
          confidence_json AS confidenceJson,
          error_text AS errorText,
          created_at AS createdAt,
          expires_at AS expiresAt
        FROM media_artifacts
        WHERE chat_id = ?
          AND telegram_message_id = ?
          AND provider = ?
          AND artifact_kind = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [
        input.chatId,
        input.telegramMessageId,
        input.provider,
        input.artifactKind
      ]
    );
  }

  getSuccessfulMediaArtifactsForMessages(input: {
    chatId: number;
    messageIds: number[];
  }): StoredMediaArtifact[] {
    if (input.messageIds.length === 0) {
      return [];
    }

    const placeholders = input.messageIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            file_unique_id AS fileUniqueId,
            chat_id AS chatId,
            telegram_message_id AS telegramMessageId,
            media_kind AS mediaKind,
            provider,
            provider_model AS providerModel,
            artifact_kind AS artifactKind,
            artifact_status AS artifactStatus,
            artifact_text AS artifactText,
            artifact_json AS artifactJson,
            raw_response_json AS rawResponseJson,
            source_caption AS sourceCaption,
            source_mime_type AS sourceMimeType,
            source_file_size AS sourceFileSize,
            source_duration_seconds AS sourceDurationSeconds,
            recognition_language AS recognitionLanguage,
            confidence_json AS confidenceJson,
            error_text AS errorText,
            created_at AS createdAt,
            expires_at AS expiresAt
          FROM media_artifacts
          WHERE chat_id = ?
            AND telegram_message_id IN (${placeholders})
            AND artifact_status = 'success'
          ORDER BY telegram_message_id DESC, created_at DESC
        `
      )
      .all(input.chatId, ...input.messageIds) as Array<{
      id: number;
      fileUniqueId: string | null;
      chatId: number;
      telegramMessageId: number;
      mediaKind: string;
      provider: string;
      providerModel: string;
      artifactKind: string;
      artifactStatus: string;
      artifactText: string | null;
      artifactJson: string | null;
      rawResponseJson: string | null;
      sourceCaption: string | null;
      sourceMimeType: string | null;
      sourceFileSize: number | null;
      sourceDurationSeconds: number | null;
      recognitionLanguage: string | null;
      confidenceJson: string | null;
      errorText: string | null;
      createdAt: string;
      expiresAt: string;
    }>;

    return rows.map(toStoredMediaArtifact);
  }

  cleanupExpiredData(input: {
    now: string;
    messageRetentionDays: number;
    mediaArtifactRetentionDays: number;
  }): { mediaArtifacts: number; messages: number; chats: number } {
    const transaction = this.db.transaction(
      (cleanupInput: {
        now: string;
        messageRetentionDays: number;
        mediaArtifactRetentionDays: number;
      }) => {
        const mediaArtifactCutoff = new Date(
          new Date(cleanupInput.now).getTime() -
            cleanupInput.mediaArtifactRetentionDays * 24 * 60 * 60 * 1000
        ).toISOString();

        const mediaArtifacts = this.db
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

        const messages = this.db
          .prepare(`DELETE FROM messages WHERE created_at < ?`)
          .run(messageCutoff).changes;

        const chats = this.db
          .prepare(
            `
              DELETE FROM chats
              WHERE chat_id NOT IN (SELECT DISTINCT chat_id FROM messages)
                AND chat_id NOT IN (SELECT DISTINCT chat_id FROM media_artifacts)
            `
          )
          .run().changes;

        return { mediaArtifacts, messages, chats };
      }
    );

    return transaction(input);
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
      this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
        name: string;
      }>
    ).map((column) => column.name);
  }

  getIndexNames(tableName: string): string[] {
    return (
      this.db.prepare(`PRAGMA index_list(${tableName})`).all() as Array<{
        name: string;
      }>
    ).map((index) => index.name);
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
  row: Omit<StoredMessage, 'isBot'> & {
    isBot: number;
    mediaKind?: string | null;
    mediaFileId?: string | null;
    mediaFileUniqueId?: string | null;
    mediaMimeType?: string | null;
    mediaFileSize?: number | null;
    mediaDurationSeconds?: number | null;
    mediaCaption?: string | null;
  }
): StoredMessage {
  return {
    chatId: row.chatId,
    messageId: row.messageId,
    userId: row.userId,
    senderDisplayName: row.senderDisplayName,
    text: row.text,
    createdAt: row.createdAt,
    isBot: Boolean(row.isBot),
    replyToMessageId: row.replyToMessageId,
    mediaSnapshot:
      row.mediaKind && row.mediaFileId
        ? ({
            messageId: row.messageId,
            mediaKind: row.mediaKind,
            fileId: row.mediaFileId,
            fileUniqueId: row.mediaFileUniqueId ?? null,
            mimeType: row.mediaMimeType ?? null,
            fileSize: row.mediaFileSize ?? null,
            durationSeconds: row.mediaDurationSeconds ?? null,
            caption: row.mediaCaption ?? null
          } as MediaMessageSnapshot)
        : null
  };
}

function stringifyJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseJsonColumn(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toStoredMediaArtifact(row: {
  id: number;
  fileUniqueId: string | null;
  chatId: number;
  telegramMessageId: number;
  mediaKind: string;
  provider: string;
  providerModel: string;
  artifactKind: string;
  artifactStatus: string;
  artifactText: string | null;
  artifactJson: string | null;
  rawResponseJson: string | null;
  sourceCaption: string | null;
  sourceMimeType: string | null;
  sourceFileSize: number | null;
  sourceDurationSeconds: number | null;
  recognitionLanguage: string | null;
  confidenceJson: string | null;
  errorText: string | null;
  createdAt: string;
  expiresAt: string;
}): StoredMediaArtifact {
  return {
    ...row,
    artifactStatus: row.artifactStatus as MediaArtifactStatus,
    artifactJson: parseJsonColumn(row.artifactJson),
    rawResponseJson: parseJsonColumn(row.rawResponseJson),
    confidenceJson: parseJsonColumn(row.confidenceJson)
  };
}

function getLatestSuccessfulMediaArtifactRow(
  db: Database.Database,
  sql: string,
  params: unknown[]
): StoredMediaArtifact | null {
  const row = db.prepare(sql).get(...params) as
    | {
        id: number;
        fileUniqueId: string | null;
        chatId: number;
        telegramMessageId: number;
        mediaKind: string;
        provider: string;
        providerModel: string;
        artifactKind: string;
        artifactStatus: string;
        artifactText: string | null;
        artifactJson: string | null;
        rawResponseJson: string | null;
        sourceCaption: string | null;
        sourceMimeType: string | null;
        sourceFileSize: number | null;
        sourceDurationSeconds: number | null;
        recognitionLanguage: string | null;
        confidenceJson: string | null;
        errorText: string | null;
        createdAt: string;
        expiresAt: string;
      }
    | undefined;

  return row ? toStoredMediaArtifact(row) : null;
}

function getLatestMediaArtifactRow(
  db: Database.Database,
  sql: string,
  params: unknown[]
): StoredMediaArtifact | null {
  const row = db.prepare(sql).get(...params) as
    | {
        id: number;
        fileUniqueId: string | null;
        chatId: number;
        telegramMessageId: number;
        mediaKind: string;
        provider: string;
        providerModel: string;
        artifactKind: string;
        artifactStatus: string;
        artifactText: string | null;
        artifactJson: string | null;
        rawResponseJson: string | null;
        sourceCaption: string | null;
        sourceMimeType: string | null;
        sourceFileSize: number | null;
        sourceDurationSeconds: number | null;
        recognitionLanguage: string | null;
        confidenceJson: string | null;
        errorText: string | null;
        createdAt: string;
        expiresAt: string;
      }
    | undefined;

  return row ? toStoredMediaArtifact(row) : null;
}

function migrateExistingSchema(db: Database.Database): void {
  ensureColumn(db, 'messages', 'media_kind', 'TEXT');
  ensureColumn(db, 'messages', 'media_file_id', 'TEXT');
  ensureColumn(db, 'messages', 'media_file_unique_id', 'TEXT');
  ensureColumn(db, 'messages', 'media_mime_type', 'TEXT');
  ensureColumn(db, 'messages', 'media_file_size', 'INTEGER');
  ensureColumn(db, 'messages', 'media_duration_seconds', 'REAL');
  ensureColumn(db, 'messages', 'media_caption', 'TEXT');
  ensureColumn(db, 'messages', 'from_user_id', 'INTEGER');
  ensureColumn(db, 'messages', 'from_username', 'TEXT');
  ensureColumn(db, 'messages', 'from_first_name', 'TEXT');
  ensureColumn(db, 'messages', 'from_last_name', 'TEXT');
  ensureColumn(db, 'messages', 'from_display_name', 'TEXT');
}

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void {
  const columns = (
    db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
      name: string;
    }>
  ).map((column) => column.name);

  if (!columns.includes(columnName)) {
    db.prepare(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
    ).run();
  }
}

function normalizeDatabaseOpenError(error: unknown, filename: string): Error {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_CANTOPEN'
  ) {
    return new Error(`Could not open SQLite database at ${filename}`);
  }

  return error instanceof Error ? error : new Error(String(error));
}
