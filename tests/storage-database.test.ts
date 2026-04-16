import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import { DatabaseClient } from "../src/storage/database.js";
import { normalizeTextMessage } from "../src/transport/telegram/normalize-message.js";

const tempDirectories: string[] = [];
const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describeWithSqlite("DatabaseClient", () => {
  test("persists reply_to_message_id on incoming and bot messages", () => {
    const db = DatabaseClient.open(":memory:");

    db.saveIncomingMessage(createIncomingMessage({ messageId: 10 }));
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 11,
        text: "ответ на первое",
        fromUserId: 99,
        fromUsername: "oleg",
        fromDisplayName: "Олег (@oleg)",
        replyToUserId: 42,
        replyToMessageId: 10
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 12,
      text: "бот ответил",
      createdAt: "2026-04-10T12:00:20.000Z",
      userId: 77,
      username: "fun_bot",
      displayName: "Fun Bot",
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

  test("normalizes explicit reply links from Telegram messages", () => {
    const ctx = {
      message: {
        message_id: 346,
        date: 1_744_300_000,
        text: "ответ",
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
          first_name: "Олег"
        },
        chat: {
          id: 1,
          type: "group"
        }
      }
    } as never;

    expect(normalizeTextMessage(ctx)).toMatchObject({
      replyToUserId: 77,
      replyToMessageId: 345
    });
  });

  test("v0 schema does not create summary, memory, or alias tables", () => {
    const db = createDatabase();

    expect(db.getSchemaColumns("chats")).toEqual([
      "chat_id",
      "chat_type",
      "title",
      "last_message_at",
      "last_bot_message_at"
    ]);
    expect(db.getSchemaColumns("participant_memories")).toEqual([]);
    expect(db.getSchemaColumns("participant_aliases")).toEqual([]);

    db.close();
  });

  test("migrates legacy schema by adding missing nullable columns", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "chatbot-db-"));
    const dbPath = path.join(directory, "bot.sqlite");
    tempDirectories.push(directory);

    const rawDb = new Database(dbPath);
    rawDb.exec(`
      CREATE TABLE chats (
        chat_id INTEGER PRIMARY KEY,
        chat_type TEXT NOT NULL,
        title TEXT,
        last_message_at TEXT,
        last_bot_message_at TEXT
      );
      CREATE TABLE participants (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        display_name TEXT NOT NULL,
        first_name TEXT,
        last_seen_at TEXT NOT NULL
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
        UNIQUE (chat_id, telegram_message_id)
      );
    `);
    rawDb.close();

    const db = DatabaseClient.open(dbPath);

    expect(db.getSchemaColumns("participants")).toContain("last_name");
    expect(db.getSchemaColumns("messages")).toContain("reply_to_telegram_message_id");
    expect(() =>
      db.saveIncomingMessage(createIncomingMessage({ replyToMessageId: 123 }))
    ).not.toThrow();
    expect(db.getMessageByTelegramMessageId(1, 10)).toMatchObject({
      replyToMessageId: 123
    });
    db.close();
  });
});

function createDatabase(): DatabaseClient {
  const directory = mkdtempSync(path.join(os.tmpdir(), "chatbot-db-"));
  const dbPath = path.join(directory, "bot.sqlite");

  tempDirectories.push(directory);

  return DatabaseClient.open(dbPath);
}

function createIncomingMessage(
  overrides: Partial<Parameters<DatabaseClient["saveIncomingMessage"]>[0]> = {}
): Parameters<DatabaseClient["saveIncomingMessage"]>[0] {
  return {
    chatId: 1,
    chatType: "group",
    chatTitle: "Friends",
    messageId: 10,
    text: "первое сообщение",
    createdAt: "2026-04-10T12:00:00.000Z",
    fromUserId: 42,
    fromUsername: "tom",
    fromFirstName: "Tom",
    fromLastName: null,
    fromDisplayName: "Tom",
    isBot: false,
    entities: [],
    replyToUserId: null,
    replyToMessageId: null,
    ...overrides
  };
}

function canUseBetterSqlite(): boolean {
  try {
    const db = new Database(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
}
