import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach } from 'vitest';

import type { IncomingMessage } from '../../src/app/chat-orchestrator/types.js';
import type { ChatPolicy } from '../../src/config/env/types.js';
import { DatabaseClient } from '../../src/database/index.js';
import type { NormalizedMessage } from '../../src/domain/models.js';
import { createTestChatPolicy } from '../helpers/telegram-fixtures.js';

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
  overrides: Partial<Omit<NormalizedMessage, 'accessContext'>> & {
    accessContext?: IncomingMessage['accessContext'];
  } = {}
): IncomingMessage {
  const message: NormalizedMessage = {
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

  return {
    ...message,
    accessContext:
      overrides.accessContext ?? resolveDefaultAccessContext(message)
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

function resolveDefaultAccessContext(
  message: Pick<NormalizedMessage, 'authorizedMode' | 'chatId' | 'chatType'>
): IncomingMessage['accessContext'] {
  if (message.authorizedMode === 'private_admin') {
    return { kind: 'private_admin' };
  }

  if (message.authorizedMode === 'private_link_sender') {
    return { kind: 'private_link_sender' };
  }

  if (message.chatType === 'private') {
    return { kind: 'private_admin' };
  }

  return {
    kind: 'configured_chat',
    policy: createPolicy(message.chatId)
  };
}

function createPolicy(chatId: number): ChatPolicy {
  return createTestChatPolicy({ chatId });
}
