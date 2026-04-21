import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { DatabaseClient } from '../src/storage/database.js';
import { normalizeTextMessage } from '../src/transport/telegram/normalize-message.js';

const tempDirectories: string[] = [];
const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describeWithSqlite('DatabaseClient', () => {
  test('persists reply_to_message_id on incoming and bot messages', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(createIncomingMessage({ messageId: 10 }));
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 11,
        text: 'ответ на первое',
        fromUserId: 99,
        fromUsername: 'oleg',
        fromDisplayName: 'Олег (@oleg)',
        replyToUserId: 42,
        replyToMessageId: 10
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: 'Friends',
      messageId: 12,
      text: 'бот ответил',
      createdAt: '2026-04-10T12:00:20.000Z',
      userId: 77,
      username: 'fun_bot',
      displayName: 'Fun Bot',
      replyToMessageId: 11
    });

    expect(db.getMessageByTelegramMessageId(1, 11)).toMatchObject({
      messageId: 11,
      replyToMessageId: 10
    });
    expect(db.getMessageByTelegramMessageId(1, 12)).toMatchObject({
      messageId: 12,
      replyToMessageId: 11
    });
    expect(
      db.getRecentMessages(1, 10).map((message) => ({
        messageId: message.messageId,
        replyToMessageId: message.replyToMessageId
      }))
    ).toEqual([
      { messageId: 10, replyToMessageId: null },
      { messageId: 11, replyToMessageId: 10 },
      { messageId: 12, replyToMessageId: 11 }
    ]);

    db.close();
  });

  test('normalizes explicit reply links from Telegram messages', () => {
    const ctx = {
      message: {
        message_id: 346,
        date: 1_744_300_000,
        text: 'ответ',
        entities: [],
        reply_to_message: {
          message_id: 345,
          from: {
            id: 77,
            is_bot: false
          }
        },
        from: {
          id: 99,
          is_bot: false,
          first_name: 'Олег'
        },
        chat: {
          id: 1,
          type: 'group'
        }
      }
    } as never;

    expect(normalizeTextMessage(ctx)).toMatchObject({
      replyToUserId: 77,
      replyToMessageId: 345
    });
  });

  test('v0 schema keeps messages and chats only, with sender metadata on messages', () => {
    const db = createDatabase();

    expect(db.getSchemaColumns('chats')).toEqual([
      'chat_id',
      'chat_type',
      'title',
      'last_message_at',
      'last_bot_message_at'
    ]);
    expect(db.getSchemaColumns('participants')).toEqual([]);
    expect(db.getSchemaColumns('chat_participants')).toEqual([]);
    expect(db.getSchemaColumns('messages')).toEqual([
      'id',
      'chat_id',
      'telegram_message_id',
      'user_id',
      'sender_display_name',
      'text',
      'created_at',
      'is_bot',
      'reply_to_telegram_message_id',
      'from_user_id',
      'from_username',
      'from_first_name',
      'from_last_name',
      'from_display_name'
    ]);

    db.close();
  });

  test('stores sender metadata directly on message rows', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        fromUserId: 42,
        fromUsername: 'tom',
        fromFirstName: 'Tom',
        fromLastName: 'Ivanov',
        fromDisplayName: 'Tom Ivanov (@tom)'
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: 'Friends',
      messageId: 11,
      text: 'бот ответил',
      createdAt: '2026-04-10T12:00:20.000Z',
      userId: 77,
      username: 'fun_bot',
      displayName: 'Fun Bot',
      replyToMessageId: 10
    });

    expect(db.getMessageByTelegramMessageId(1, 10)).toMatchObject({
      userId: 42,
      senderDisplayName: 'Tom Ivanov (@tom)',
      replyToMessageId: null
    });
    expect(db.getMessageByTelegramMessageId(1, 11)).toMatchObject({
      userId: 77,
      senderDisplayName: 'Fun Bot',
      replyToMessageId: 10
    });

    db.close();
  });

  test('creates the media artifact schema and indexes', () => {
    const db = DatabaseClient.open(':memory:');

    expect(db.getSchemaColumns('media_artifacts')).toEqual([
      'id',
      'file_unique_id',
      'chat_id',
      'telegram_message_id',
      'media_kind',
      'provider',
      'provider_model',
      'artifact_kind',
      'artifact_status',
      'artifact_text',
      'artifact_json',
      'raw_response_json',
      'source_caption',
      'source_mime_type',
      'source_file_size',
      'source_duration_seconds',
      'recognition_language',
      'confidence_json',
      'error_text',
      'created_at',
      'expires_at'
    ]);
    expect(db.getIndexNames('media_artifacts').sort()).toEqual(
      [
        'idx_media_artifacts_expires_at',
        'idx_media_artifacts_file_unique_provider',
        'idx_media_artifacts_message_provider'
      ].sort()
    );

    db.close();
  });

  test('stores and reads cached media artifacts with file_unique_id preference', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatTitle: 'Cache chat',
        messageId: 20,
        createdAt: '2026-04-21T09:59:00.000Z'
      })
    );
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatTitle: 'Cache chat',
        messageId: 21,
        createdAt: '2026-04-21T09:58:00.000Z'
      })
    );

    db.saveMediaArtifact({
      fileUniqueId: null,
      chatId: 1,
      telegramMessageId: 21,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: 'from-message-fallback',
      artifactJson: {
        type: 'transcript',
        transcript: 'from-message-fallback'
      },
      rawResponseJson: { status: 'done' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 123,
      sourceDurationSeconds: 3,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-21T09:59:00.000Z',
      expiresAt: '2026-04-28T09:59:00.000Z'
    });

    db.saveMediaArtifact({
      fileUniqueId: 'telegram-file-unique',
      chatId: 1,
      telegramMessageId: 20,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: 'привет',
      artifactJson: {
        type: 'transcript',
        transcript: 'привет',
        language: null,
        duration: 3
      },
      rawResponseJson: { status: 'done' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 123,
      sourceDurationSeconds: 3,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-21T10:00:00.000Z',
      expiresAt: '2026-04-28T10:00:00.000Z'
    });

    expect(
      db.getSuccessfulMediaArtifact({
        fileUniqueId: 'telegram-file-unique',
        chatId: 1,
        telegramMessageId: 20,
        provider: 'gladia',
        artifactKind: 'transcript'
      })
    ).toMatchObject({
      fileUniqueId: 'telegram-file-unique',
      artifactText: 'привет',
      artifactStatus: 'success',
      artifactJson: {
        type: 'transcript',
        transcript: 'привет',
        language: null,
        duration: 3
      },
      rawResponseJson: { status: 'done' }
    });

    expect(
      db.getSuccessfulMediaArtifact({
        fileUniqueId: null,
        chatId: 1,
        telegramMessageId: 21,
        provider: 'gladia',
        artifactKind: 'transcript'
      })
    ).toMatchObject({
      fileUniqueId: null,
      artifactText: 'from-message-fallback'
    });

    db.close();
  });

  test('does not return failed media artifacts from the cache', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatTitle: 'Cache chat',
        messageId: 20,
        createdAt: '2026-04-21T10:00:00.000Z'
      })
    );

    db.saveMediaArtifact({
      fileUniqueId: 'telegram-file-unique',
      chatId: 1,
      telegramMessageId: 20,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'failed',
      artifactText: null,
      artifactJson: null,
      rawResponseJson: { status: 'error' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 123,
      sourceDurationSeconds: 3,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: 'provider failed',
      createdAt: '2026-04-21T10:00:00.000Z',
      expiresAt: '2026-04-28T10:00:00.000Z'
    });

    expect(
      db.getSuccessfulMediaArtifact({
        fileUniqueId: 'telegram-file-unique',
        chatId: 1,
        telegramMessageId: 20,
        provider: 'gladia',
        artifactKind: 'transcript'
      })
    ).toBe(null);

    db.close();
  });

  test('cleans up expired media artifacts, old messages, and empty chats', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatTitle: 'Old chat',
        messageId: 10,
        createdAt: '2026-04-10T00:00:00.000Z'
      })
    );
    db.saveMediaArtifact({
      fileUniqueId: 'old-file-unique',
      chatId: 1,
      telegramMessageId: 10,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: 'old transcript',
      artifactJson: { transcript: 'old transcript' },
      rawResponseJson: { status: 'done' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 123,
      sourceDurationSeconds: 3,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-10T00:00:00.000Z',
      expiresAt: '2026-04-11T00:00:00.000Z'
    });

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 2,
        chatTitle: 'Recent chat',
        messageId: 20,
        createdAt: '2026-04-26T00:00:00.000Z'
      })
    );
    db.saveMediaArtifact({
      fileUniqueId: 'recent-file-unique',
      chatId: 2,
      telegramMessageId: 20,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: 'recent transcript',
      artifactJson: { transcript: 'recent transcript' },
      rawResponseJson: { status: 'done' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 456,
      sourceDurationSeconds: 4,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-26T00:00:00.000Z',
      expiresAt: '2026-05-03T00:00:00.000Z'
    });

    expect(
      db.cleanupExpiredData({
        now: '2026-04-29T00:00:00.000Z',
        messageRetentionDays: 7,
        mediaArtifactRetentionDays: 7
      })
    ).toEqual({
      mediaArtifacts: 1,
      messages: 1,
      chats: 1
    });
    expect(db.getChatState(1)).toBe(null);
    expect(db.getMessageByTelegramMessageId(2, 20)).not.toBe(null);
    expect(
      db.getSuccessfulMediaArtifact({
        fileUniqueId: 'recent-file-unique',
        chatId: 2,
        telegramMessageId: 20,
        provider: 'gladia',
        artifactKind: 'transcript'
      })
    ).not.toBe(null);

    db.close();
  });

  test('keeps chats with retained media artifacts after old messages are cleaned', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatTitle: 'Artifact chat',
        messageId: 10,
        createdAt: '2026-04-10T00:00:00.000Z'
      })
    );
    db.saveMediaArtifact({
      fileUniqueId: 'retained-file-unique',
      chatId: 1,
      telegramMessageId: 10,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: 'retained transcript',
      artifactJson: { transcript: 'retained transcript' },
      rawResponseJson: { status: 'done' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 123,
      sourceDurationSeconds: 3,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-20T00:00:00.000Z',
      expiresAt: '2026-05-20T00:00:00.000Z'
    });

    expect(
      db.cleanupExpiredData({
        now: '2026-04-29T00:00:00.000Z',
        messageRetentionDays: 7,
        mediaArtifactRetentionDays: 30
      })
    ).toEqual({
      mediaArtifacts: 0,
      messages: 1,
      chats: 0
    });
    expect(db.getChatState(1)).not.toBe(null);
    expect(
      db.getSuccessfulMediaArtifact({
        fileUniqueId: 'retained-file-unique',
        chatId: 1,
        telegramMessageId: 10,
        provider: 'gladia',
        artifactKind: 'transcript'
      })
    ).toMatchObject({ artifactText: 'retained transcript' });

    db.close();
  });

  test('stores app state key values', () => {
    const db = DatabaseClient.open(':memory:');

    expect(db.getAppState('last_announced_deploy_sha')).toBe(null);

    db.setAppState(
      'last_announced_deploy_sha',
      'abc123',
      '2026-04-19T10:00:00.000Z'
    );

    expect(db.getAppState('last_announced_deploy_sha')).toBe('abc123');

    db.setAppState(
      'last_announced_deploy_sha',
      'def456',
      '2026-04-19T10:05:00.000Z'
    );

    expect(db.getAppState('last_announced_deploy_sha')).toBe('def456');

    db.close();
  });

  test('adds app_state table when opening an existing database', () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'chatbot-app-state-db-')
    );
    const dbPath = path.join(directory, 'bot.sqlite');
    tempDirectories.push(directory);

    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE chats (
        chat_id INTEGER PRIMARY KEY,
        chat_type TEXT NOT NULL,
        title TEXT,
        last_message_at TEXT,
        last_bot_message_at TEXT
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        telegram_message_id INTEGER NOT NULL,
        user_id INTEGER,
        sender_display_name TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        is_bot INTEGER NOT NULL DEFAULT 0,
        reply_to_telegram_message_id INTEGER,
        UNIQUE (chat_id, telegram_message_id)
      );
    `);
    legacyDb.close();

    const db = DatabaseClient.open(dbPath);

    expect(db.getSchemaColumns('app_state')).toEqual([
      'key',
      'value',
      'updated_at'
    ]);

    db.close();
  });

  test('adds media_artifacts when opening an existing database', () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'chatbot-media-artifacts-db-')
    );
    const dbPath = path.join(directory, 'bot.sqlite');
    tempDirectories.push(directory);

    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE chats (
        chat_id INTEGER PRIMARY KEY,
        chat_type TEXT NOT NULL,
        title TEXT,
        last_message_at TEXT,
        last_bot_message_at TEXT
      );

      CREATE TABLE messages (
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
        UNIQUE (chat_id, telegram_message_id)
      );
    `);
    legacyDb.close();

    const db = DatabaseClient.open(dbPath);

    expect(db.getSchemaColumns('media_artifacts')).toEqual([
      'id',
      'file_unique_id',
      'chat_id',
      'telegram_message_id',
      'media_kind',
      'provider',
      'provider_model',
      'artifact_kind',
      'artifact_status',
      'artifact_text',
      'artifact_json',
      'raw_response_json',
      'source_caption',
      'source_mime_type',
      'source_file_size',
      'source_duration_seconds',
      'recognition_language',
      'confidence_json',
      'error_text',
      'created_at',
      'expires_at'
    ]);

    db.close();
  });

  test('adds sender metadata columns when opening a pre-reset database', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'chatbot-legacy-db-'));
    const dbPath = path.join(directory, 'bot.sqlite');
    tempDirectories.push(directory);

    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE chats (
        chat_id INTEGER PRIMARY KEY,
        chat_type TEXT NOT NULL,
        title TEXT,
        last_message_at TEXT,
        last_bot_message_at TEXT
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        telegram_message_id INTEGER NOT NULL,
        user_id INTEGER,
        sender_display_name TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        is_bot INTEGER NOT NULL DEFAULT 0,
        reply_to_telegram_message_id INTEGER,
        UNIQUE (chat_id, telegram_message_id)
      );
    `);
    legacyDb.close();

    const db = DatabaseClient.open(dbPath);

    expect(db.getSchemaColumns('messages')).toContain('from_display_name');
    expect(
      db.saveIncomingMessage(
        createIncomingMessage({
          messageId: 20,
          fromDisplayName: 'Legacy Safe'
        })
      )
    ).toBe(true);
    expect(db.getMessageByTelegramMessageId(1, 20)).toMatchObject({
      senderDisplayName: 'Legacy Safe'
    });

    db.close();
  });
});

function createDatabase(): DatabaseClient {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'chatbot-db-'));
  const dbPath = path.join(directory, 'bot.sqlite');

  tempDirectories.push(directory);

  return DatabaseClient.open(dbPath);
}

function createIncomingMessage(
  overrides: Partial<Parameters<DatabaseClient['saveIncomingMessage']>[0]> = {}
): Parameters<DatabaseClient['saveIncomingMessage']>[0] {
  return {
    chatId: 1,
    chatType: 'group',
    chatTitle: 'Friends',
    messageId: 10,
    text: 'первое сообщение',
    createdAt: '2026-04-10T12:00:00.000Z',
    fromUserId: 42,
    fromUsername: 'tom',
    fromFirstName: 'Tom',
    fromLastName: null,
    fromDisplayName: 'Tom',
    isBot: false,
    entities: [],
    replyToUserId: null,
    replyToMessageId: null,
    replyToMessageSnapshot: null,
    replyToMediaSnapshot: null,
    ...overrides
  };
}

function canUseBetterSqlite(): boolean {
  try {
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}
