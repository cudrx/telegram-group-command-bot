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

  test("v0 schema keeps messages and chats only, with sender metadata on messages", () => {
    const db = createDatabase();

    expect(db.getSchemaColumns("chats")).toEqual([
      "chat_id",
      "chat_type",
      "title",
      "last_message_at",
      "last_bot_message_at"
    ]);
    expect(db.getSchemaColumns("participants")).toEqual([]);
    expect(db.getSchemaColumns("chat_participants")).toEqual([]);
    expect(db.getSchemaColumns("messages")).toEqual([
      "id",
      "chat_id",
      "telegram_message_id",
      "user_id",
      "sender_display_name",
      "text",
      "created_at",
      "is_bot",
      "reply_to_telegram_message_id",
      "from_user_id",
      "from_username",
      "from_first_name",
      "from_last_name",
      "from_display_name"
    ]);

    db.close();
  });

  test("stores sender metadata directly on message rows", () => {
    const db = DatabaseClient.open(":memory:");

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        fromUserId: 42,
        fromUsername: "tom",
        fromFirstName: "Tom",
        fromLastName: "Ivanov",
        fromDisplayName: "Tom Ivanov (@tom)"
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 11,
      text: "бот ответил",
      createdAt: "2026-04-10T12:00:20.000Z",
      userId: 77,
      username: "fun_bot",
      displayName: "Fun Bot",
      replyToMessageId: 10
    });

    expect(db.getMessageByTelegramMessageId(1, 10)).toMatchObject({
      userId: 42,
      senderDisplayName: "Tom Ivanov (@tom)",
      replyToMessageId: null
    });
    expect(db.getMessageByTelegramMessageId(1, 11)).toMatchObject({
      userId: 77,
      senderDisplayName: "Fun Bot",
      replyToMessageId: 10
    });

    db.close();
  });

  test("stores app state key values", () => {
    const db = DatabaseClient.open(":memory:");

    expect(db.getAppState("last_announced_deploy_sha")).toBe(null);

    db.setAppState(
      "last_announced_deploy_sha",
      "abc123",
      "2026-04-19T10:00:00.000Z"
    );

    expect(db.getAppState("last_announced_deploy_sha")).toBe("abc123");

    db.setAppState(
      "last_announced_deploy_sha",
      "def456",
      "2026-04-19T10:05:00.000Z"
    );

    expect(db.getAppState("last_announced_deploy_sha")).toBe("def456");

    db.close();
  });

  test("adds app_state table when opening an existing database", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "chatbot-app-state-db-"));
    const dbPath = path.join(directory, "bot.sqlite");
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

    expect(db.getSchemaColumns("app_state")).toEqual(["key", "value", "updated_at"]);

    db.close();
  });

  test("adds sender metadata columns when opening a pre-reset database", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "chatbot-legacy-db-"));
    const dbPath = path.join(directory, "bot.sqlite");
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

    expect(db.getSchemaColumns("messages")).toContain("from_display_name");
    expect(
      db.saveIncomingMessage(
        createIncomingMessage({
          messageId: 20,
          fromDisplayName: "Legacy Safe"
        })
      )
    ).toBe(true);
    expect(db.getMessageByTelegramMessageId(1, 20)).toMatchObject({
      senderDisplayName: "Legacy Safe"
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
    replyToMessageSnapshot: null,
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
