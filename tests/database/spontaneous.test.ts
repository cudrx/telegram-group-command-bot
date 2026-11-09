import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { buildReplyContext } from '../../src/app/reply-context-builder.js';
import { DatabaseClient } from '../../src/database/index.js';
import { buildAnswerMessages } from '../../src/llm/openai-compatible-client/answer.js';
import { createConversationGraph } from '../helpers/conversation-plan.js';
import {
  canUseBetterSqlite,
  createDatabase,
  createIncomingMessage,
  trackTempDirectory
} from './support.js';

const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

describeWithSqlite('spontaneous provenance', () => {
  test('keeps a labeled bot joke in reply ancestry and both assistant prompts', () => {
    const db = createDatabase();
    db.saveIncomingMessage(createIncomingMessage({ messageId: 1 }));
    db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: 'test',
      messageId: 2,
      userId: 77,
      username: 'fun_bot',
      displayName: 'Fun Bot',
      text: 'сервер ушёл за пельменями',
      createdAt: '2026-04-10T12:01:00.000Z',
      generationKind: 'spontaneous_markov_llm'
    });
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 3,
        text: 'почему?',
        replyToMessageId: 2
      })
    );
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 4,
        text: '@fun_bot объясни',
        replyToMessageId: 3
      })
    );
    for (const rows of [
      db.getRecentMessages(1, 10),
      db.getMessagesBefore(1, 4, 10),
      db.getMessagesInRange({
        chatId: 1,
        fromInclusive: '2026-04-10',
        toExclusive: '2026-04-11'
      })
    ])
      expect(
        rows.find((message) => message.messageId === 2)?.generationKind
      ).toBe('spontaneous_markov_llm');

    expect(db.getMessageByTelegramMessageId(1, 2)?.generationKind).toBe(
      'spontaneous_markov_llm'
    );
    for (const triggerMessageId of [3, 4]) {
      const context = buildReplyContext({
        db,
        chatId: 1,
        triggerMessageId,
        contextLimit: 20,
        intent: 'answer',
        botUserId: 77
      });
      const input = {
        assistantInstructions: '',
        currentDateTime: 'now',
        replyContext: context
      };
      for (const prompt of [
        buildAnswerMessages(input),
        buildAnswerMessages({
          ...input,
          plan: {
            mode: 'direct',
            ...createConversationGraph([
              1,
              2,
              ...(triggerMessageId === 4 ? [3] : [])
            ])
          }
        })
      ]) {
        expect(prompt[1]?.content).toContain(
          'actor=bot Fun Bot generationKind=spontaneous_markov_llm'
        );
        expect(prompt[1]?.content).toContain('сервер ушёл за пельменями');
      }
    }
    db.close();
  });

  test('migrates existing messages as standard and preserves new provenance across reopen', () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'spontaneous-migration-')
    );
    trackTempDirectory(directory);
    const filename = path.join(directory, 'bot.sqlite');
    const old = new Database(filename);
    old.exec(`CREATE TABLE chats (chat_id INTEGER PRIMARY KEY, chat_type TEXT NOT NULL, title TEXT, last_message_at TEXT, last_bot_message_at TEXT);
      CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, telegram_message_id INTEGER NOT NULL, user_id INTEGER, sender_display_name TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, is_bot INTEGER NOT NULL DEFAULT 0, reply_to_telegram_message_id INTEGER, UNIQUE(chat_id, telegram_message_id));
      INSERT INTO chats VALUES (1, 'group', 'test', NULL, NULL);
      INSERT INTO messages VALUES (1, 1, 1, 42, 'Human', 'hello', '2026-04-10T12:00:00Z', 0, NULL);`);
    old.close();
    let db = DatabaseClient.open(filename);
    expect(db.getMessageByTelegramMessageId(1, 1)?.generationKind).toBe(
      'standard'
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: 'test',
      messageId: 2,
      userId: 77,
      username: null,
      displayName: 'Bot',
      text: 'joke',
      createdAt: '2026-04-10T12:01:00Z',
      generationKind: 'spontaneous_markov_llm'
    });
    db.close();
    db = DatabaseClient.open(filename);
    expect(db.getMessageByTelegramMessageId(1, 2)?.generationKind).toBe(
      'spontaneous_markov_llm'
    );
    db.close();
  });
});
