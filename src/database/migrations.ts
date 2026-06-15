import type Database from 'better-sqlite3';

import { answerActionConfig } from '../config/runtime/index.js';

export function migrateExistingSchema(db: Database.Database): void {
  ensureColumn(db, 'messages', 'media_kind', 'TEXT');
  ensureColumn(db, 'messages', 'media_file_id', 'TEXT');
  ensureColumn(db, 'messages', 'media_file_unique_id', 'TEXT');
  ensureColumn(db, 'messages', 'media_mime_type', 'TEXT');
  ensureColumn(db, 'messages', 'media_file_size', 'INTEGER');
  ensureColumn(db, 'messages', 'media_duration_seconds', 'REAL');
  ensureColumn(db, 'messages', 'media_caption', 'TEXT');
  ensureColumn(db, 'messages', 'media_group_id', 'TEXT');
  ensureColumn(db, 'messages', 'from_user_id', 'INTEGER');
  ensureColumn(db, 'messages', 'from_username', 'TEXT');
  ensureColumn(db, 'messages', 'from_first_name', 'TEXT');
  ensureColumn(db, 'messages', 'from_last_name', 'TEXT');
  ensureColumn(db, 'messages', 'from_display_name', 'TEXT');
  ensureColumn(db, 'messages', 'output_mode', "TEXT NOT NULL DEFAULT 'text'");
  ensureColumn(db, 'messages', 'edited_at', 'TEXT');
  ensureColumn(db, 'chats', 'answer_last_output_mode', 'TEXT');
  ensureColumn(
    db,
    'chats',
    'answer_eligible_text_since_voice',
    `INTEGER NOT NULL DEFAULT ${answerActionConfig.outboundTts.minEligibleTextGap}`
  );
  ensureColumn(
    db,
    'chats',
    'answer_eligible_text_streak',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumn(db, 'chats', 'read_last_voice_at', 'TEXT');
  ensureColumn(
    db,
    'chats',
    'read_tts_voice_count',
    'INTEGER NOT NULL DEFAULT 0'
  );
  ensureMemePosts(db);
  ensureSourceStates(db);
}

function ensureMemePosts(db: Database.Database): void {
  db.prepare(
    `
      CREATE TABLE IF NOT EXISTS meme_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reddit_post_id TEXT NOT NULL,
        subreddit TEXT NOT NULL,
        chat_id INTEGER NOT NULL,
        telegram_message_id INTEGER,
        title TEXT NOT NULL,
        permalink TEXT NOT NULL,
        media_kind TEXT NOT NULL,
        media_url TEXT,
        upvotes INTEGER NOT NULL DEFAULT 0,
        sent_at TEXT NOT NULL,
        UNIQUE (chat_id, reddit_post_id)
      )
    `
  ).run();
  db.prepare(
    `
      CREATE INDEX IF NOT EXISTS idx_meme_posts_chat_sent_at
      ON meme_posts(chat_id, sent_at)
    `
  ).run();
  db.prepare(
    `
      CREATE INDEX IF NOT EXISTS idx_meme_posts_chat_post
      ON meme_posts(chat_id, reddit_post_id)
    `
  ).run();
}

function ensureSourceStates(db: Database.Database): void {
  db.prepare(
    `
      CREATE TABLE IF NOT EXISTS source_states (
        source_key TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        reason TEXT,
        blocked_at TEXT,
        cookie_file_mtime_ms_at_block REAL,
        updated_at TEXT NOT NULL
      )
    `
  ).run();
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
