import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { DatabaseClient } from '../../src/database/index.js';
import {
  canUseBetterSqlite,
  createIncomingMessage,
  trackTempDirectory
} from './support.js';

const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

describeWithSqlite('DatabaseClient migrations', () => {
  test('adds app_state table when opening an existing database', () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'chatbot-app-state-db-')
    );
    const dbPath = path.join(directory, 'bot.sqlite');
    trackTempDirectory(directory);

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
    trackTempDirectory(directory);

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
    expect(db.getSchemaColumns('media_artifacts')).toContain('artifact_kind');
    db.close();
  });

  test('adds media_group_id when opening an existing database', () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'chatbot-media-group-db-')
    );
    const dbPath = path.join(directory, 'bot.sqlite');
    trackTempDirectory(directory);

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
    expect(db.getSchemaColumns('messages')).toContain('media_group_id');
    db.close();
  });

  test('adds sender metadata columns when opening a pre-reset database', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'chatbot-legacy-db-'));
    const dbPath = path.join(directory, 'bot.sqlite');
    trackTempDirectory(directory);

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
