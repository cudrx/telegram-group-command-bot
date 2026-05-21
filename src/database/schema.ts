import { answerActionConfig } from '../config/runtime/index.js';

export const schema = `
CREATE TABLE IF NOT EXISTS chats (
  chat_id INTEGER PRIMARY KEY,
  chat_type TEXT NOT NULL,
  title TEXT,
  last_message_at TEXT,
  last_bot_message_at TEXT,
  answer_last_output_mode TEXT,
  answer_eligible_text_since_voice INTEGER NOT NULL DEFAULT ${answerActionConfig.outboundTts.minEligibleTextGap},
  answer_eligible_text_streak INTEGER NOT NULL DEFAULT 0,
  read_last_voice_at TEXT,
  read_tts_voice_count INTEGER NOT NULL DEFAULT 0
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
  media_group_id TEXT,
  from_user_id INTEGER,
  from_username TEXT,
  from_first_name TEXT,
  from_last_name TEXT,
  from_display_name TEXT,
  output_mode TEXT NOT NULL DEFAULT 'text',
  edited_at TEXT,
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
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created_at
  ON messages(chat_id, created_at);

CREATE INDEX IF NOT EXISTS idx_media_artifacts_file_unique_provider
  ON media_artifacts(file_unique_id, provider, artifact_kind, artifact_status);

CREATE INDEX IF NOT EXISTS idx_media_artifacts_message_provider
  ON media_artifacts(chat_id, telegram_message_id, provider, artifact_kind, artifact_status);

CREATE INDEX IF NOT EXISTS idx_media_artifacts_expires_at
  ON media_artifacts(expires_at);

CREATE INDEX IF NOT EXISTS idx_meme_posts_chat_sent_at
  ON meme_posts(chat_id, sent_at);

CREATE INDEX IF NOT EXISTS idx_meme_posts_chat_post
  ON meme_posts(chat_id, reddit_post_id);
`;
