import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import {
  getLatestMediaArtifact,
  getSuccessfulMediaArtifact,
  getSuccessfulMediaArtifactsForMessages,
  saveMediaArtifact
} from './artifacts.js';
import { cleanupExpiredData } from './artifacts-cleanup.js';
import { normalizeDatabaseOpenError } from './errors.js';
import { getRecentMemePostIds, saveMemePost } from './meme-posts.js';
import {
  getChatState,
  getMessageByTelegramMessageId,
  getMessagesBefore,
  getMessagesInRange,
  getRecentMessages,
  saveBotMessage,
  saveIncomingMessage,
  updateChatTtsState,
  updateIncomingMessageEdit
} from './messages.js';
import { migrateExistingSchema } from './migrations.js';
import { schema } from './schema.js';
import type {
  ChatState,
  NormalizedMessage,
  SaveMediaArtifactInput,
  SaveMemePostInput,
  StoredMediaArtifact,
  StoredMessage,
  UpdateChatTtsStateInput
} from './types.js';

export type {
  BotOutputMode,
  MediaArtifactStatus,
  MemeMediaKind,
  SaveMediaArtifactInput,
  SaveMemePostInput,
  StoredMediaArtifact,
  UpdateChatTtsStateInput
} from './types.js';

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
    return saveIncomingMessage(this.db, message);
  }

  updateIncomingMessageEdit(input: {
    chatId: number;
    messageId: number;
    text: string;
    editedAt: string;
  }): boolean {
    return updateIncomingMessageEdit(this.db, input);
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
    outputMode?: 'text' | 'voice';
  }): void {
    saveBotMessage(this.db, input);
  }

  updateChatTtsState(input: UpdateChatTtsStateInput): void {
    updateChatTtsState(this.db, input);
  }

  getChatState(chatId: number): ChatState | null {
    return getChatState(this.db, chatId);
  }

  getRecentMessages(chatId: number, limit: number): StoredMessage[] {
    return getRecentMessages(this.db, chatId, limit);
  }

  getMessagesBefore(
    chatId: number,
    beforeMessageId: number,
    limit: number
  ): StoredMessage[] {
    return getMessagesBefore(this.db, chatId, beforeMessageId, limit);
  }

  getMessagesInRange(input: {
    chatId: number;
    fromInclusive: string;
    toExclusive: string;
  }): StoredMessage[] {
    return getMessagesInRange(this.db, input);
  }

  getMessageByTelegramMessageId(
    chatId: number,
    messageId: number
  ): StoredMessage | null {
    return getMessageByTelegramMessageId(this.db, chatId, messageId);
  }

  saveMediaArtifact(input: SaveMediaArtifactInput): void {
    saveMediaArtifact(this.db, input);
  }

  getSuccessfulMediaArtifact(input: {
    fileUniqueId: string | null;
    chatId: number;
    telegramMessageId: number;
    provider: string;
    artifactKind: string;
  }): StoredMediaArtifact | null {
    return getSuccessfulMediaArtifact(this.db, input);
  }

  getLatestMediaArtifact(input: {
    fileUniqueId: string | null;
    chatId: number;
    telegramMessageId: number;
    provider: string;
    artifactKind: string;
  }): StoredMediaArtifact | null {
    return getLatestMediaArtifact(this.db, input);
  }

  getSuccessfulMediaArtifactsForMessages(input: {
    chatId: number;
    messageIds: number[];
  }): StoredMediaArtifact[] {
    return getSuccessfulMediaArtifactsForMessages(this.db, input);
  }

  saveMemePost(input: SaveMemePostInput): void {
    saveMemePost(this.db, input);
  }

  getRecentMemePostIds(input: {
    chatId: number;
    redditPostIds: string[];
    since: string;
  }): Set<string> {
    return getRecentMemePostIds(this.db, input);
  }

  cleanupExpiredData(input: {
    now: string;
    messageRetentionDays: number;
    mediaArtifactRetentionDays: number;
    memeHistoryRetentionDays: number;
  }): {
    mediaArtifacts: number;
    messages: number;
    chats: number;
    memePosts: number;
  } {
    return cleanupExpiredData(this.db, input);
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
