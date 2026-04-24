import { DatabaseClient } from '../src/database/index.js';
import { buildWeeklyPreview } from '../src/app/weekly/index.js';

function readChatId(): number {
  const value = process.env.TELEGRAM_CHAT_ID;

  if (!value?.trim()) {
    throw new Error('TELEGRAM_CHAT_ID is required for weekly smoke preview');
  }

  const chatId = Number(value);

  if (!Number.isSafeInteger(chatId)) {
    throw new Error(
      `TELEGRAM_CHAT_ID must be a valid integer, received "${value}"`
    );
  }

  return chatId;
}

function main(): void {
  const sqlitePath = process.env.SQLITE_PATH ?? 'data/prod-smoke.sqlite';
  const now = process.env.WEEKLY_NOW ?? new Date().toISOString();
  const db = DatabaseClient.open(sqlitePath);

  try {
    const preview = buildWeeklyPreview({
      db,
      chatId: readChatId(),
      now
    });

    console.log(preview.dataset);
  } finally {
    db.close();
  }
}

main();
