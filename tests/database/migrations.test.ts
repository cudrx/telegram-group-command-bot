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

  test('adds meme_posts table and indexes when opening an existing database', () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'chatbot-meme-posts-db-')
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
    expect(db.getSchemaColumns('meme_posts')).toEqual([
      'id',
      'reddit_post_id',
      'subreddit',
      'chat_id',
      'telegram_message_id',
      'title',
      'permalink',
      'media_kind',
      'media_url',
      'upvotes',
      'sent_at'
    ]);
    expect(db.getIndexNames('meme_posts')).toEqual(
      expect.arrayContaining([
        'idx_meme_posts_chat_post',
        'idx_meme_posts_chat_sent_at'
      ])
    );
    db.close();
  });

  test('adds news_posts table and indexes when opening an existing database', () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'chatbot-news-posts-db-')
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
    expect(db.getSchemaColumns('news_posts')).toEqual([
      'id',
      'source_slug',
      'message_id',
      'published_at',
      'fetched_at',
      'text',
      'url',
      'content_hash'
    ]);
    expect(db.getIndexNames('news_posts')).toEqual(
      expect.arrayContaining([
        'idx_news_posts_published_at',
        'idx_news_posts_source_published_at'
      ])
    );
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

  test('adds outbound tts columns when opening a legacy database', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'chatbot-tts-db-'));
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

    expect(db.getSchemaColumns('messages')).toContain('output_mode');
    expect(db.getSchemaColumns('chats')).toContain('answer_last_output_mode');
    expect(db.getSchemaColumns('chats')).toContain(
      'answer_eligible_text_since_voice'
    );
    expect(db.getSchemaColumns('chats')).toContain(
      'answer_eligible_text_streak'
    );
    expect(db.getSchemaColumns('chats')).toContain('read_last_voice_at');
    expect(db.getSchemaColumns('chats')).toContain('read_tts_voice_count');

    db.saveIncomingMessage(createIncomingMessage({ messageId: 20 }));
    expect(db.getMessageByTelegramMessageId(1, 20)).toMatchObject({
      outputMode: 'text'
    });
    expect(db.getChatState(1)).toMatchObject({
      answerLastOutputMode: null,
      answerEligibleTextSinceVoice: 3,
      answerEligibleTextStreak: 0,
      readLastVoiceAt: null,
      readTtsVoiceCount: 0
    });

    db.close();
  });

  test('adds edited_at when opening a legacy database', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'chatbot-edits-db-'));
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

    expect(db.getSchemaColumns('messages')).toContain('edited_at');
    db.saveIncomingMessage(createIncomingMessage({ messageId: 20 }));
    expect(
      db.updateIncomingMessageEdit({
        chatId: 1,
        messageId: 20,
        text: 'legacy edit',
        editedAt: '2026-04-10T12:01:00.000Z'
      })
    ).toBe(true);
    expect(db.getMessageByTelegramMessageId(1, 20)).toMatchObject({
      text: 'legacy edit',
      editedAt: '2026-04-10T12:01:00.000Z'
    });

    db.close();
  });
});
