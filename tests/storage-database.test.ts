import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import { DatabaseClient } from "../src/storage/database.js";

const tempDirectories: string[] = [];
const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describeWithSqlite("DatabaseClient", () => {
  test("keeps newer messages unsummarized when summary applies through an older cursor", () => {
    const db = createDatabase();

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        messageId: 1,
        createdAt: "2026-04-03T12:00:00.000Z",
        text: "первое"
      })
    );
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        messageId: 2,
        createdAt: "2026-04-03T12:01:00.000Z",
        text: "второе"
      })
    );

    db.applySummary(
      1,
      {
        chatSummary: "краткая выжимка",
        memoryUpdates: [],
        selfMemoryUpdates: []
      },
      1,
      "2026-04-03T12:05:00.000Z"
    );

    expect(db.getChatState(1)?.summaryCursorMessageId).toBe(1);
    expect(db.getChatState(1)?.unsummarizedMessageCount).toBe(1);

    db.close();
  });

  test("stores participant memories per chat instead of globally", () => {
    const db = createDatabase();

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        messageId: 1,
        createdAt: "2026-04-03T12:00:00.000Z",
        text: "чат один"
      })
    );
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 2,
        messageId: 1,
        createdAt: "2026-04-03T12:01:00.000Z",
        text: "чат два"
      })
    );

    db.applySummary(
      1,
      {
        chatSummary: "summary-1",
        memoryUpdates: [
          {
            userId: 42,
            category: "preference",
            key: "favorite_club",
            valueText: "Манчестер",
            stability: "durable",
            sourceKind: "explicit",
            confidence: 0.9,
            cardinality: "single"
          }
        ],
        selfMemoryUpdates: []
      },
      1,
      "2026-04-03T12:02:00.000Z"
    );
    db.applySummary(
      2,
      {
        chatSummary: "summary-2",
        memoryUpdates: [
          {
            userId: 42,
            category: "preference",
            key: "favorite_club",
            valueText: "Ливерпуль",
            stability: "durable",
            sourceKind: "explicit",
            confidence: 0.95,
            cardinality: "single"
          }
        ],
        selfMemoryUpdates: []
      },
      1,
      "2026-04-03T12:03:00.000Z"
    );

    expect(db.getParticipantMemoryContext(1, 42)).toContain(
      "Манчестер"
    );
    expect(db.getParticipantMemoryContext(2, 42)).toContain(
      "Ливерпуль"
    );

    db.close();
  });

  test("supersedes conflicting single-value memories and expires volatile ones", () => {
    const db = createDatabase();

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        messageId: 1,
        createdAt: "2026-04-03T12:00:00.000Z",
        text: "я за Манчестер"
      })
    );

    db.applySummary(
      1,
      {
        chatSummary: "summary-1",
        memoryUpdates: [
          {
            userId: 42,
            category: "preference",
            key: "favorite_club",
            valueText: "Манчестер",
            stability: "durable",
            sourceKind: "explicit",
            confidence: 0.9,
            cardinality: "single"
          },
          {
            userId: 42,
            category: "appearance",
            key: "headwear",
            valueText: "новая кепка",
            stability: "volatile",
            sourceKind: "observed",
            confidence: 0.8,
            cardinality: "single"
          }
        ],
        selfMemoryUpdates: []
      },
      1,
      "2026-04-03T12:00:00.000Z"
    );
    db.applySummary(
      1,
      {
        chatSummary: "summary-2",
        memoryUpdates: [
          {
            userId: 42,
            category: "preference",
            key: "favorite_club",
            valueText: "Ливерпуль",
            stability: "durable",
            sourceKind: "explicit",
            confidence: 0.95,
            cardinality: "single"
          }
        ],
        selfMemoryUpdates: []
      },
      1,
      "2026-04-10T12:00:00.000Z"
    );

    db.runChatMaintenance({
      chatId: 1,
      now: "2026-04-25T12:00:01.000Z",
      messageRetentionDays: 180,
      minMessagesToKeep: 16
    });

    expect(
      db.getParticipantMemoryContext(1, 42)
    ).toContain("Ливерпуль");
    expect(
      db.getParticipantMemoryContext(1, 42)
    ).not.toContain("кепка");

    db.close();
  });

  test("migrates legacy databases and backfills chat-scoped profile columns", () => {
    const filename = createDatabaseFile();
    const legacyDb = new Database(filename);

    legacyDb.exec(`
      CREATE TABLE chats (
        chat_id INTEGER PRIMARY KEY,
        chat_type TEXT NOT NULL,
        title TEXT,
        last_message_at TEXT,
        last_bot_message_at TEXT,
        summary_text TEXT,
        summary_updated_at TEXT,
        summary_cursor_message_id INTEGER NOT NULL DEFAULT 0,
        unsummarized_message_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE participants (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        display_name TEXT NOT NULL,
        first_name TEXT,
        last_seen_at TEXT NOT NULL,
        profile_summary_text TEXT,
        profile_updated_at TEXT
      );

      CREATE TABLE chat_participants (
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (chat_id, user_id)
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

      INSERT INTO chats (chat_id, chat_type, title, last_message_at)
      VALUES (1, 'group', 'Friends', '2026-04-03T12:00:00.000Z');

      INSERT INTO participants (
        user_id,
        username,
        display_name,
        first_name,
        last_seen_at,
        profile_summary_text,
        profile_updated_at
      )
      VALUES (
        42,
        'tom',
        'Tom',
        'Tom',
        '2026-04-03T12:00:00.000Z',
        'legacy profile',
        '2026-04-03T12:00:00.000Z'
      );

      INSERT INTO chat_participants (chat_id, user_id, last_seen_at)
      VALUES (1, 42, '2026-04-03T12:00:00.000Z');
    `);
    legacyDb.close();

    const db = DatabaseClient.open(filename);

    expect(db.getParticipantProfile(1, 42)?.profileSummaryText).toBe("legacy profile");

    db.close();
  });

  test("prunes summarized messages older than retention while keeping a recent raw tail", () => {
    const db = createDatabase();

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        messageId: 1,
        createdAt: "2026-01-01T12:00:00.000Z",
        text: "старое 1"
      })
    );
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        messageId: 2,
        createdAt: "2026-01-02T12:00:00.000Z",
        text: "старое 2"
      })
    );
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        messageId: 3,
        createdAt: "2026-03-01T12:00:00.000Z",
        text: "ещё держим"
      })
    );
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        messageId: 4,
        createdAt: "2026-04-01T12:00:00.000Z",
        text: "последнее"
      })
    );

    db.applySummary(
      1,
      {
        chatSummary: "summary",
        memoryUpdates: [],
        selfMemoryUpdates: []
      },
      3,
      "2026-04-02T12:00:00.000Z"
    );

    db.runMaintenance({
      now: "2026-04-20T12:00:00.000Z",
      messageRetentionDays: 30,
      minMessagesToKeep: 2
    });

    expect(db.getRecentMessages(1, 10).map((message) => message.messageId)).toEqual([3, 4]);

    db.close();
  });

  test("stores bot self-memory in the same chat-local memory layer without rewriting core persona", () => {
    const db = createDatabase();

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        messageId: 1,
        createdAt: "2026-04-03T12:00:00.000Z",
        text: "@bot погнали"
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 2,
      text: "я тут, как всегда, шучу про дедлайны",
      createdAt: "2026-04-03T12:01:00.000Z",
      userId: 77,
      username: "fun_bot",
      displayName: "Fun Bot"
    });

    db.applySummary(
      1,
      {
        chatSummary: "summary",
        memoryUpdates: [],
        selfMemoryUpdates: [
          {
            category: "relationship",
            key: "running_joke_with_tom",
            valueText: "часто шутит про дедлайны с Томом",
            stability: "durable",
            sourceKind: "observed",
            confidence: 0.81,
            cardinality: "single"
          },
          {
            category: "identity",
            key: "persona",
            valueText: "теперь строгий модератор",
            stability: "core",
            sourceKind: "observed",
            confidence: 0.9,
            cardinality: "single"
          }
        ]
      },
      2,
      "2026-04-03T12:02:00.000Z",
      {
        userId: 77,
        username: "fun_bot",
        displayName: "Fun Bot"
      }
    );

    expect(db.getParticipantMemoryContext(1, 77)).toContain(
      "running_joke_with_tom"
    );
    expect(db.getParticipantMemoryContext(1, 77)).not.toContain(
      "строгий модератор"
    );

    db.close();
  });
});

function createDatabase(): DatabaseClient {
  return DatabaseClient.open(createDatabaseFile());
}

function createDatabaseFile(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "chatbot-db-"));

  tempDirectories.push(directory);

  return path.join(directory, "test.sqlite");
}

function createIncomingMessage(input: {
  chatId: number;
  messageId: number;
  createdAt: string;
  text: string;
}) {
  return {
    chatId: input.chatId,
    chatType: "group" as const,
    chatTitle: "Friends",
    messageId: input.messageId,
    text: input.text,
    createdAt: input.createdAt,
    fromUserId: 42,
    fromUsername: "tom",
    fromFirstName: "Tom",
    fromDisplayName: "Tom",
    isBot: false,
    entities: [],
    replyToUserId: null
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
