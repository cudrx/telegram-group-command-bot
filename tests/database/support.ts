import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach } from 'vitest';

import { DatabaseClient } from '../../src/database/index.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

export function createDatabase(): DatabaseClient {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'chatbot-db-'));
  const dbPath = path.join(directory, 'bot.sqlite');

  tempDirectories.push(directory);

  return DatabaseClient.open(dbPath);
}

export function trackTempDirectory(directory: string): void {
  tempDirectories.push(directory);
}

export function createIncomingMessage(
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
    mediaSnapshot: null,
    ...overrides
  };
}

export function canUseBetterSqlite(): boolean {
  try {
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}
