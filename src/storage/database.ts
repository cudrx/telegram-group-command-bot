import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  buildParticipantMemoryDigest,
  clampParticipantMemoryConfidence,
  getParticipantMemoryExpiresAt,
  getResolvedMemoryRetentionCutoff,
  normalizeParticipantMemoryKey,
  normalizeParticipantMemoryValue,
  pickMoreStableMemoryStability,
  pickStrongerMemorySource,
  shouldRejectBotSelfMemoryUpdate,
  shouldRejectParticipantMemoryUpdate
} from "../domain/participant-memory.js";
import type {
  ChatState,
  NormalizedMessage,
  ParticipantAliasKind,
  ParticipantAliasRecord,
  ParticipantMemory,
  ParticipantMemoryCardinality,
  ParticipantMemorySourceKind,
  ParticipantMemoryStability,
  ParticipantMemoryUpdate,
  ParticipantProfile,
  StoredMessage,
  SummaryResult
} from "../domain/models.js";

const schema = `
CREATE TABLE IF NOT EXISTS chats (
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

CREATE TABLE IF NOT EXISTS participants (
  user_id INTEGER PRIMARY KEY,
  username TEXT,
  display_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  last_seen_at TEXT NOT NULL,
  profile_summary_text TEXT,
  profile_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS chat_participants (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_seen_at TEXT NOT NULL,
  profile_summary_text TEXT,
  profile_updated_at TEXT,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES participants(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS participant_memories (
  memory_id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  value_text TEXT NOT NULL,
  value_normalized TEXT NOT NULL,
  stability TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  confidence REAL NOT NULL,
  cardinality TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_confirmed_at TEXT,
  expires_at TEXT,
  supersedes_memory_id INTEGER,
  FOREIGN KEY (chat_id, user_id) REFERENCES chat_participants(chat_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (supersedes_memory_id) REFERENCES participant_memories(memory_id) ON DELETE SET NULL
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
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE,
  UNIQUE (chat_id, telegram_message_id)
);

CREATE TABLE IF NOT EXISTS participant_aliases (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  alias_text TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  alias_kind TEXT NOT NULL,
  confidence REAL NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (chat_id, user_id, alias_normalized, alias_kind),
  FOREIGN KEY (chat_id, user_id) REFERENCES chat_participants(chat_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created_at
  ON messages(chat_id, created_at);

CREATE INDEX IF NOT EXISTS idx_participant_memories_lookup
  ON participant_memories(chat_id, user_id, status, memory_key, value_normalized);

CREATE INDEX IF NOT EXISTS idx_participant_memories_context
  ON participant_memories(chat_id, user_id, status, is_pinned, stability, confidence, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_participant_aliases_lookup
  ON participant_aliases(chat_id, alias_normalized);
`;

export class DatabaseClient {
  private constructor(private readonly db: Database.Database) {}

  static open(filename: string): DatabaseClient {
    const directory = path.dirname(filename);

    if (directory !== ".") {
      mkdirSync(directory, { recursive: true });
    }

    let db: Database.Database;

    try {
      db = new Database(filename);
    } catch (error) {
      throw normalizeDatabaseOpenError(error, filename);
    }

    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(schema);
    migrateExistingSchema(db);

    return new DatabaseClient(db);
  }

  saveIncomingMessage(message: NormalizedMessage): boolean {
    const transaction = this.db.transaction((incoming: NormalizedMessage) => {
      this.db
        .prepare(
          `
            INSERT INTO chats (chat_id, chat_type, title, last_message_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
              chat_type = excluded.chat_type,
              title = excluded.title,
              last_message_at = excluded.last_message_at
          `
        )
        .run(
          incoming.chatId,
          incoming.chatType,
          incoming.chatTitle,
          incoming.createdAt
        );

      if (incoming.fromUserId !== null) {
        upsertChatParticipant(this.db, {
          chatId: incoming.chatId,
          userId: incoming.fromUserId,
          username: incoming.fromUsername,
          displayName: incoming.fromDisplayName,
          firstName: incoming.fromFirstName,
          lastName: incoming.fromLastName,
          seenAt: incoming.createdAt
        });
      }

      const result = this.db
        .prepare(
          `
            INSERT OR IGNORE INTO messages (
              chat_id,
              telegram_message_id,
              user_id,
              sender_display_name,
              text,
              created_at,
              is_bot
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          incoming.chatId,
          incoming.messageId,
          incoming.fromUserId,
          incoming.fromDisplayName,
          incoming.text,
          incoming.createdAt,
          incoming.isBot ? 1 : 0
        );

      if (result.changes > 0) {
        this.db
          .prepare(
            `
              UPDATE chats
              SET
                last_message_at = ?,
                unsummarized_message_count = unsummarized_message_count + 1
              WHERE chat_id = ?
            `
          )
          .run(incoming.createdAt, incoming.chatId);
      }

      return result.changes > 0;
    });

    return transaction(message);
  }

  saveBotMessage(input: {
    chatId: number;
    chatType: string;
    chatTitle: string | null;
    messageId: number;
    text: string;
    createdAt: string;
    userId: number;
    username: string | null;
    displayName: string;
  }): void {
    const transaction = this.db.transaction(
      (outgoing: {
        chatId: number;
        chatType: string;
        chatTitle: string | null;
        messageId: number;
        text: string;
        createdAt: string;
        userId: number;
        username: string | null;
        displayName: string;
      }) => {
        this.db
          .prepare(
            `
              INSERT INTO chats (chat_id, chat_type, title, last_message_at, last_bot_message_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(chat_id) DO UPDATE SET
                chat_type = excluded.chat_type,
                title = excluded.title,
                last_message_at = excluded.last_message_at,
                last_bot_message_at = excluded.last_bot_message_at
            `
          )
          .run(
            outgoing.chatId,
            outgoing.chatType,
            outgoing.chatTitle,
            outgoing.createdAt,
            outgoing.createdAt
          );

        upsertChatParticipant(this.db, {
          chatId: outgoing.chatId,
          userId: outgoing.userId,
          username: outgoing.username,
          displayName: outgoing.displayName,
          firstName: null,
          lastName: null,
          seenAt: outgoing.createdAt
        });

        const result = this.db
          .prepare(
            `
              INSERT OR IGNORE INTO messages (
                chat_id,
                telegram_message_id,
                user_id,
                sender_display_name,
                text,
                created_at,
                is_bot
              )
              VALUES (?, ?, ?, ?, ?, ?, 1)
            `
          )
          .run(
            outgoing.chatId,
            outgoing.messageId,
            outgoing.userId,
            outgoing.displayName,
            outgoing.text,
            outgoing.createdAt
          );

        if (result.changes > 0) {
          this.db
            .prepare(
              `
                UPDATE chats
                SET
                  last_message_at = ?,
                  last_bot_message_at = ?,
                  unsummarized_message_count = unsummarized_message_count + 1
                WHERE chat_id = ?
              `
            )
            .run(outgoing.createdAt, outgoing.createdAt, outgoing.chatId);
        }
      }
    );

    transaction(input);
  }

  getChatState(chatId: number): ChatState | null {
    const row = this.db
      .prepare(
        `
          SELECT
            chat_id AS chatId,
            chat_type AS chatType,
            title,
            last_message_at AS lastMessageAt,
            last_bot_message_at AS lastBotMessageAt,
            summary_text AS summaryText,
            summary_updated_at AS summaryUpdatedAt,
            summary_cursor_message_id AS summaryCursorMessageId,
            unsummarized_message_count AS unsummarizedMessageCount
          FROM chats
          WHERE chat_id = ?
        `
      )
      .get(chatId) as ChatState | undefined;

    return row ?? null;
  }

  listSummaryCandidates(): ChatState[] {
    return this.db
      .prepare(
        `
          SELECT
            chat_id AS chatId,
            chat_type AS chatType,
            title,
            last_message_at AS lastMessageAt,
            last_bot_message_at AS lastBotMessageAt,
            summary_text AS summaryText,
            summary_updated_at AS summaryUpdatedAt,
            summary_cursor_message_id AS summaryCursorMessageId,
            unsummarized_message_count AS unsummarizedMessageCount
          FROM chats
          WHERE unsummarized_message_count > 0
        `
      )
      .all() as ChatState[];
  }

  runMaintenance(input: {
    now: string;
    messageRetentionDays: number;
    minMessagesToKeep: number;
  }): void {
    const transaction = this.db.transaction(
      (options: {
        now: string;
        messageRetentionDays: number;
        minMessagesToKeep: number;
      }) => {
        const chatIds = this.db
          .prepare(
            `
              SELECT chat_id AS chatId
              FROM chats
            `
          )
          .all() as Array<{ chatId: number }>;

        for (const { chatId } of chatIds) {
          this.runChatMaintenance({
            chatId,
            now: options.now,
            messageRetentionDays: options.messageRetentionDays,
            minMessagesToKeep: options.minMessagesToKeep
          });
        }
      }
    );

    transaction(input);
  }

  runChatMaintenance(input: {
    chatId: number;
    now: string;
    messageRetentionDays: number;
    minMessagesToKeep: number;
  }): void {
    const transaction = this.db.transaction(
      (options: {
        chatId: number;
        now: string;
        messageRetentionDays: number;
        minMessagesToKeep: number;
      }) => {
        expireOutdatedParticipantMemories(this.db, options.chatId, options.now);
        pruneResolvedParticipantMemories(this.db, options.chatId, options.now);
        refreshParticipantProfileCachesForChat(this.db, options.chatId, options.now);
        pruneSummarizedMessages(this.db, {
          chatId: options.chatId,
          now: options.now,
          retentionDays: options.messageRetentionDays,
          minMessagesToKeep: options.minMessagesToKeep
        });
      }
    );

    transaction(input);
  }

  getParticipantProfile(chatId: number, userId: number): ParticipantProfile | null {
    const row = this.db
      .prepare(
        `
          SELECT
            cp.chat_id AS chatId,
            cp.user_id AS userId,
            p.username AS username,
            p.display_name AS displayName,
            p.last_name AS lastName,
            cp.profile_summary_text AS profileSummaryText,
            cp.profile_updated_at AS profileUpdatedAt
          FROM chat_participants cp
          INNER JOIN participants p
            ON p.user_id = cp.user_id
          WHERE cp.chat_id = ? AND cp.user_id = ?
        `
      )
      .get(chatId, userId) as ParticipantProfile | undefined;

    return row ?? null;
  }

  getParticipantMemoryContext(chatId: number, userId: number): string | null {
    return this.getParticipantProfile(chatId, userId)?.profileSummaryText ?? null;
  }

  getParticipantAliases(chatId: number, aliasNormalized: string): ParticipantAliasRecord[] {
    return this.db
      .prepare(
        `
          SELECT
            pa.chat_id AS chatId,
            pa.user_id AS userId,
            pa.alias_text AS aliasText,
            pa.alias_normalized AS aliasNormalized,
            pa.alias_kind AS aliasKind,
            pa.confidence AS confidence,
            pa.last_seen_at AS lastSeenAt,
            p.display_name AS displayName
          FROM participant_aliases pa
          INNER JOIN participants p
            ON p.user_id = pa.user_id
          WHERE pa.chat_id = ? AND pa.alias_normalized = ?
          ORDER BY pa.user_id ASC
        `
      )
      .all(chatId, normalizeParticipantAlias(aliasNormalized)) as ParticipantAliasRecord[];
  }

  getSchemaColumns(tableName: string): string[] {
    return (
      this.db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all() as Array<{ name: string }>
    ).map((column) => column.name);
  }

  listParticipantMemories(
    chatId: number,
    userId: number,
    options: {
      includeResolved?: boolean;
      limit?: number;
    } = {}
  ): ParticipantMemory[] {
    return selectParticipantMemories(this.db, chatId, userId, options);
  }

  getRecentMessages(chatId: number, limit: number): StoredMessage[] {
    type StoredMessageRow = Omit<StoredMessage, "isBot"> & { isBot: number };

    const rows = this.db
      .prepare(
        `
          SELECT
            chat_id AS chatId,
            telegram_message_id AS messageId,
            user_id AS userId,
            sender_display_name AS senderDisplayName,
            text,
            created_at AS createdAt,
            is_bot AS isBot
          FROM messages
          WHERE chat_id = ?
          ORDER BY telegram_message_id DESC
          LIMIT ?
        `
      )
      .all(chatId, limit) as StoredMessageRow[];

    return rows
      .reverse()
      .map((row) => ({ ...row, isBot: Boolean(row.isBot) }));
  }

  getMessagesSince(chatId: number, telegramMessageId: number): StoredMessage[] {
    type StoredMessageRow = Omit<StoredMessage, "isBot"> & { isBot: number };

    const rows = this.db
      .prepare(
        `
          SELECT
            chat_id AS chatId,
            telegram_message_id AS messageId,
            user_id AS userId,
            sender_display_name AS senderDisplayName,
            text,
            created_at AS createdAt,
            is_bot AS isBot
          FROM messages
          WHERE chat_id = ? AND telegram_message_id > ?
          ORDER BY telegram_message_id ASC
        `
      )
      .all(chatId, telegramMessageId) as StoredMessageRow[];

    return rows.map((row) => ({ ...row, isBot: Boolean(row.isBot) }));
  }

  applySummary(
    chatId: number,
    result: SummaryResult,
    appliedThroughMessageId: number,
    updatedAt: string,
    botIdentity?: {
      userId: number;
      username: string | null;
      displayName: string;
    }
  ): void {
    const transaction = this.db.transaction(
      (
        targetChatId: number,
        summary: SummaryResult,
        cursorMessageId: number,
        timestamp: string,
        currentBotIdentity?: {
          userId: number;
          username: string | null;
          displayName: string;
        }
      ) => {
        this.db
          .prepare(
            `
              UPDATE chats
              SET
                summary_text = ?,
                summary_updated_at = ?,
                summary_cursor_message_id = ?,
                unsummarized_message_count = (
                  SELECT COUNT(*)
                  FROM messages
                  WHERE chat_id = ? AND telegram_message_id > ?
                )
              WHERE chat_id = ?
            `
          )
          .run(
            summary.chatSummary,
            timestamp,
            cursorMessageId,
            targetChatId,
            cursorMessageId,
            targetChatId
          );

        expireOutdatedParticipantMemories(this.db, targetChatId, timestamp);

        for (const update of summary.memoryUpdates) {
          mergeParticipantMemory(this.db, targetChatId, update, timestamp);
        }

        if (
          currentBotIdentity &&
          summary.selfMemoryUpdates.length > 0
        ) {
          upsertChatParticipant(this.db, {
            chatId: targetChatId,
            userId: currentBotIdentity.userId,
            username: currentBotIdentity.username,
            displayName: currentBotIdentity.displayName,
            firstName: null,
            lastName: null,
            seenAt: timestamp
          });

          for (const update of summary.selfMemoryUpdates) {
            mergeParticipantMemory(
              this.db,
              targetChatId,
              {
                ...update,
                userId: currentBotIdentity.userId
              },
              timestamp,
              "bot_self"
            );
          }
        }

        refreshParticipantProfileCachesForChat(this.db, targetChatId, timestamp);
        pruneResolvedParticipantMemories(this.db, targetChatId, timestamp);
      }
    );

    transaction(chatId, result, appliedThroughMessageId, updatedAt, botIdentity);
  }

  close(): void {
    this.db.close();
  }
}

type ParticipantMemoryRow = Omit<ParticipantMemory, "isPinned"> & { isPinned: number };

type StoredMemoryUpdate = ParticipantMemoryUpdate & {
  category: string;
  key: string;
  valueText: string;
  valueNormalized: string;
  confidence: number;
};

function mergeParticipantMemory(
  db: Database.Database,
  chatId: number,
  update: ParticipantMemoryUpdate,
  timestamp: string,
  memoryScope: "participant" | "bot_self" = "participant"
): void {
  const normalized = normalizeMemoryUpdate(update, memoryScope);

  if (!normalized) {
    return;
  }

  const sameValueMemory = db
    .prepare(
      `
        SELECT
          memory_id AS memoryId,
          chat_id AS chatId,
          user_id AS userId,
          category,
          memory_key AS key,
          value_text AS valueText,
          value_normalized AS valueNormalized,
          stability,
          source_kind AS sourceKind,
          confidence,
          cardinality,
          status,
          is_pinned AS isPinned,
          first_seen_at AS firstSeenAt,
          last_seen_at AS lastSeenAt,
          last_confirmed_at AS lastConfirmedAt,
          expires_at AS expiresAt,
          supersedes_memory_id AS supersedesMemoryId
        FROM participant_memories
        WHERE chat_id = ? AND user_id = ? AND memory_key = ? AND value_normalized = ? AND status = 'active'
        ORDER BY is_pinned DESC, confidence DESC, memory_id DESC
        LIMIT 1
      `
    )
    .get(
      chatId,
      normalized.userId,
      normalized.key,
      normalized.valueNormalized
    ) as ParticipantMemoryRow | undefined;
  const incomingExpiresAt = getParticipantMemoryExpiresAt(
    normalized.stability,
    timestamp
  );

  if (sameValueMemory) {
    db.prepare(
      `
        UPDATE participant_memories
        SET
          category = ?,
          stability = ?,
          source_kind = ?,
          confidence = ?,
          cardinality = ?,
          last_seen_at = ?,
          last_confirmed_at = ?,
          expires_at = ?
        WHERE memory_id = ?
      `
    ).run(
      normalized.category,
      pickMoreStableMemoryStability(sameValueMemory.stability, normalized.stability),
      pickStrongerMemorySource(sameValueMemory.sourceKind, normalized.sourceKind),
      Math.max(sameValueMemory.confidence, normalized.confidence),
      pickMoreRestrictiveCardinality(sameValueMemory.cardinality, normalized.cardinality),
      timestamp,
      timestamp,
      chooseMemoryExpiration(
        sameValueMemory.expiresAt,
        incomingExpiresAt,
        pickMoreStableMemoryStability(sameValueMemory.stability, normalized.stability)
      ),
      sameValueMemory.memoryId
    );

    return;
  }

  const supersededIds =
    normalized.cardinality === "single"
      ? supersedeConflictingMemories(db, chatId, normalized.userId, normalized.key, normalized.valueNormalized, timestamp)
      : [];

  db.prepare(
    `
      INSERT INTO participant_memories (
        chat_id,
        user_id,
        category,
        memory_key,
        value_text,
        value_normalized,
        stability,
        source_kind,
        confidence,
        cardinality,
        status,
        is_pinned,
        first_seen_at,
        last_seen_at,
        last_confirmed_at,
        expires_at,
        supersedes_memory_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?)
    `
  ).run(
    chatId,
    normalized.userId,
    normalized.category,
    normalized.key,
    normalized.valueText,
    normalized.valueNormalized,
    normalized.stability,
    normalized.sourceKind,
    normalized.confidence,
    normalized.cardinality,
    timestamp,
    timestamp,
    timestamp,
    incomingExpiresAt,
    supersededIds[0] ?? null
  );
}

function supersedeConflictingMemories(
  db: Database.Database,
  chatId: number,
  userId: number,
  key: string,
  valueNormalized: string,
  timestamp: string
): number[] {
  const rows = db
    .prepare(
      `
        SELECT memory_id AS memoryId
        FROM participant_memories
        WHERE chat_id = ? AND user_id = ? AND memory_key = ? AND status = 'active' AND value_normalized != ?
        ORDER BY confidence DESC, memory_id DESC
      `
    )
    .all(chatId, userId, key, valueNormalized) as Array<{ memoryId: number }>;

  if (rows.length === 0) {
    return [];
  }

  const supersedeStatement = db.prepare(
    `
      UPDATE participant_memories
      SET
        status = 'superseded',
        last_seen_at = ?
      WHERE memory_id = ?
    `
  );

  for (const row of rows) {
    supersedeStatement.run(timestamp, row.memoryId);
  }

  return rows.map((row) => row.memoryId);
}

function normalizeMemoryUpdate(
  update: ParticipantMemoryUpdate,
  memoryScope: "participant" | "bot_self"
): StoredMemoryUpdate | null {
  const normalizedKey = normalizeParticipantMemoryKey(update.key);
  const normalizedValue = normalizeParticipantMemoryValue(update.valueText);
  const normalizedCategory = normalizeParticipantMemoryKey(update.category) || "general";
  const valueText = update.valueText.trim().replace(/\s+/g, " ");
  const candidate: ParticipantMemoryUpdate = {
    ...update,
    category: normalizedCategory,
    key: normalizedKey,
    valueText,
    confidence: clampParticipantMemoryConfidence(update.confidence)
  };

  const shouldReject =
    memoryScope === "bot_self"
      ? shouldRejectBotSelfMemoryUpdate(candidate)
      : shouldRejectParticipantMemoryUpdate(candidate);

  if (shouldReject) {
    return null;
  }

  return {
    ...candidate,
    valueNormalized: normalizedValue
  };
}

function chooseMemoryExpiration(
  currentExpiresAt: string | null,
  incomingExpiresAt: string | null,
  resultingStability: ParticipantMemoryStability
): string | null {
  if (resultingStability !== "volatile") {
    return null;
  }

  if (currentExpiresAt === null) {
    return incomingExpiresAt;
  }

  if (incomingExpiresAt === null) {
    return currentExpiresAt;
  }

  return Date.parse(currentExpiresAt) >= Date.parse(incomingExpiresAt)
    ? currentExpiresAt
    : incomingExpiresAt;
}

function pickMoreRestrictiveCardinality(
  current: ParticipantMemoryCardinality,
  incoming: ParticipantMemoryCardinality
): ParticipantMemoryCardinality {
  return current === "single" || incoming === "single" ? "single" : "multi";
}

function selectParticipantMemories(
  db: Database.Database,
  chatId: number,
  userId: number,
  options: {
    includeResolved?: boolean;
    limit?: number;
  }
): ParticipantMemory[] {
  const rows = db
    .prepare(
      `
        SELECT
          memory_id AS memoryId,
          chat_id AS chatId,
          user_id AS userId,
          category,
          memory_key AS key,
          value_text AS valueText,
          value_normalized AS valueNormalized,
          stability,
          source_kind AS sourceKind,
          confidence,
          cardinality,
          status,
          is_pinned AS isPinned,
          first_seen_at AS firstSeenAt,
          last_seen_at AS lastSeenAt,
          last_confirmed_at AS lastConfirmedAt,
          expires_at AS expiresAt,
          supersedes_memory_id AS supersedesMemoryId
        FROM participant_memories
        WHERE chat_id = ? AND user_id = ?
          AND (? = 1 OR status = 'active')
        ORDER BY
          is_pinned DESC,
          CASE stability
            WHEN 'core' THEN 3
            WHEN 'durable' THEN 2
            ELSE 1
          END DESC,
          confidence DESC,
          COALESCE(last_confirmed_at, last_seen_at) DESC,
          memory_id DESC
        LIMIT ?
      `
    )
    .all(
      chatId,
      userId,
      options.includeResolved ? 1 : 0,
      options.limit ?? 100
    ) as ParticipantMemoryRow[];

  return rows.map((row) => ({
    ...row,
    isPinned: Boolean(row.isPinned)
  }));
}

function expireOutdatedParticipantMemories(
  db: Database.Database,
  chatId: number,
  now: string,
  userId?: number
): void {
  if (userId === undefined) {
    db.prepare(
      `
        UPDATE participant_memories
        SET
          status = 'expired',
          last_seen_at = ?
        WHERE chat_id = ?
          AND status = 'active'
          AND expires_at IS NOT NULL
          AND expires_at <= ?
      `
    ).run(now, chatId, now);

    return;
  }

  db.prepare(
    `
      UPDATE participant_memories
      SET
        status = 'expired',
        last_seen_at = ?
      WHERE chat_id = ?
        AND user_id = ?
        AND status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at <= ?
    `
  ).run(now, chatId, userId, now);
}

function refreshParticipantProfileCachesForChat(
  db: Database.Database,
  chatId: number,
  updatedAt: string
): void {
  const rows = db
    .prepare(
      `
        SELECT user_id AS userId
        FROM chat_participants
        WHERE chat_id = ?
      `
    )
    .all(chatId) as Array<{ userId: number }>;

  for (const row of rows) {
    refreshParticipantProfileCache(db, chatId, row.userId, updatedAt);
  }
}

function refreshParticipantProfileCache(
  db: Database.Database,
  chatId: number,
  userId: number,
  updatedAt: string
): void {
  if (countParticipantMemories(db, chatId, userId) === 0) {
    db.prepare(
      `
        UPDATE chat_participants
        SET
          profile_summary_text = NULL,
          profile_updated_at = ?
        WHERE chat_id = ? AND user_id = ?
      `
    ).run(updatedAt, chatId, userId);

    return;
  }

  const digest = buildParticipantMemoryDigest(
    selectParticipantMemories(db, chatId, userId, {
      includeResolved: false,
      limit: 24
    }),
    updatedAt
  );

  db.prepare(
    `
      UPDATE chat_participants
      SET
        profile_summary_text = ?,
        profile_updated_at = ?
      WHERE chat_id = ? AND user_id = ?
    `
  ).run(digest, updatedAt, chatId, userId);
}

function countParticipantMemories(
  db: Database.Database,
  chatId: number,
  userId: number
): number {
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM participant_memories
        WHERE chat_id = ? AND user_id = ?
      `
    )
    .get(chatId, userId) as { count: number };

  return row.count;
}

function upsertChatParticipant(
  db: Database.Database,
  input: {
    chatId: number;
    userId: number;
    username: string | null;
    displayName: string;
    firstName: string | null;
    lastName: string | null;
    seenAt: string;
  }
): void {
  db.prepare(
    `
      INSERT INTO participants (user_id, username, display_name, first_name, last_name, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        display_name = excluded.display_name,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        last_seen_at = excluded.last_seen_at
    `
  ).run(
    input.userId,
    input.username,
    input.displayName,
    input.firstName,
    input.lastName,
    input.seenAt
  );

  db.prepare(
    `
      INSERT INTO chat_participants (chat_id, user_id, last_seen_at)
      VALUES (?, ?, ?)
      ON CONFLICT(chat_id, user_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at
    `
  ).run(input.chatId, input.userId, input.seenAt);

  upsertParticipantAliases(db, input);
}

function upsertParticipantAliases(
  db: Database.Database,
  input: {
    chatId: number;
    userId: number;
    username: string | null;
    displayName: string;
    firstName: string | null;
    lastName: string | null;
    seenAt: string;
  }
): void {
  const aliases = buildParticipantAliases(input);

  db.prepare(`DELETE FROM participant_aliases WHERE chat_id = ? AND user_id = ?`).run(
    input.chatId,
    input.userId
  );

  const statement = db.prepare(
    `
      INSERT INTO participant_aliases (
        chat_id,
        user_id,
        alias_text,
        alias_normalized,
        alias_kind,
        confidence,
        last_seen_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id, user_id, alias_normalized, alias_kind) DO UPDATE SET
        alias_text = excluded.alias_text,
        confidence = excluded.confidence,
        last_seen_at = excluded.last_seen_at
    `
  );

  for (const alias of aliases) {
    statement.run(
      input.chatId,
      input.userId,
      alias.aliasText,
      alias.aliasNormalized,
      alias.aliasKind,
      1,
      input.seenAt
    );
  }
}

function buildParticipantAliases(input: {
  username: string | null;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
}): Array<{
  aliasText: string;
  aliasNormalized: string;
  aliasKind: ParticipantAliasKind;
}> {
  const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  const aliases = new Map<string, { aliasText: string; aliasKind: ParticipantAliasKind }>();

  const addAlias = (aliasText: string | null, aliasKind: ParticipantAliasKind) => {
    const normalized = normalizeParticipantAlias(aliasText);

    if (!normalized) {
      return;
    }

    aliases.set(`${aliasKind}:${normalized}`, { aliasText: aliasText!.trim(), aliasKind });
  };

  addAlias(input.username, "username");
  addAlias(input.firstName, "first_name");
  addAlias(fullName, "full_name");
  addAlias(stripUsernameFromDisplayName(input.displayName), "canonical_label");

  return Array.from(aliases.entries()).map(([key, value]) => ({
    aliasText: value.aliasText,
    aliasNormalized: key.slice(key.indexOf(":") + 1),
    aliasKind: value.aliasKind
  }));
}

function normalizeParticipantAlias(value: string | null): string {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function stripUsernameFromDisplayName(displayName: string): string {
  return displayName
    .replace(/\s*\(@[^)]+\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pruneResolvedParticipantMemories(
  db: Database.Database,
  chatId: number,
  now: string
): void {
  const cutoff = getResolvedMemoryRetentionCutoff(now);

  if (cutoff === null) {
    return;
  }

  db.prepare(
    `
      DELETE FROM participant_memories
      WHERE chat_id = ?
        AND status IN ('superseded', 'expired', 'rejected')
        AND last_seen_at < ?
    `
  ).run(chatId, cutoff);
}

function pruneSummarizedMessages(
  db: Database.Database,
  input: {
    chatId: number;
    now: string;
    retentionDays: number;
    minMessagesToKeep: number;
  }
): void {
  const cutoff = getMessageRetentionCutoff(input.now, input.retentionDays);

  if (cutoff === null) {
    return;
  }

  const summaryCursorRow = db
    .prepare(
      `
        SELECT summary_cursor_message_id AS summaryCursorMessageId
        FROM chats
        WHERE chat_id = ?
      `
    )
    .get(input.chatId) as { summaryCursorMessageId: number } | undefined;

  const summaryCursorMessageId = summaryCursorRow?.summaryCursorMessageId ?? 0;

  if (summaryCursorMessageId <= 0) {
    return;
  }

  const oldestRetainedMessageId = getOldestRetainedMessageId(
    db,
    input.chatId,
    input.minMessagesToKeep
  );

  if (oldestRetainedMessageId === null) {
    return;
  }

  db.prepare(
    `
      DELETE FROM messages
      WHERE chat_id = ?
        AND telegram_message_id <= ?
        AND telegram_message_id < ?
        AND created_at < ?
    `
  ).run(
    input.chatId,
    summaryCursorMessageId,
    oldestRetainedMessageId,
    cutoff
  );
}

function getOldestRetainedMessageId(
  db: Database.Database,
  chatId: number,
  minMessagesToKeep: number
): number | null {
  if (minMessagesToKeep <= 0) {
    return Number.MAX_SAFE_INTEGER;
  }

  const row = db
    .prepare(
      `
        SELECT telegram_message_id AS messageId
        FROM messages
        WHERE chat_id = ?
        ORDER BY telegram_message_id DESC
        LIMIT 1 OFFSET ?
      `
    )
    .get(chatId, minMessagesToKeep - 1) as { messageId: number } | undefined;

  return row?.messageId ?? null;
}

function getMessageRetentionCutoff(now: string, retentionDays: number): string | null {
  if (retentionDays <= 0) {
    return null;
  }

  const parsedNow = Date.parse(now);

  if (Number.isNaN(parsedNow)) {
    return null;
  }

  return new Date(parsedNow - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

function migrateExistingSchema(db: Database.Database): void {
  ensureColumn(db, "participants", "last_name", "TEXT");
  ensureColumn(db, "chat_participants", "profile_summary_text", "TEXT");
  ensureColumn(db, "chat_participants", "profile_updated_at", "TEXT");
  ensureParticipantAliasesTable(db);
  backfillChatParticipantProfiles(db);
}

function ensureParticipantAliasesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS participant_aliases (
      chat_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      alias_text TEXT NOT NULL,
      alias_normalized TEXT NOT NULL,
      alias_kind TEXT NOT NULL,
      confidence REAL NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE (chat_id, user_id, alias_normalized, alias_kind),
      FOREIGN KEY (chat_id, user_id) REFERENCES chat_participants(chat_id, user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_participant_aliases_lookup
      ON participant_aliases(chat_id, alias_normalized);
  `);
}

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function backfillChatParticipantProfiles(db: Database.Database): void {
  db.exec(`
    UPDATE chat_participants
    SET
      profile_summary_text = (
        SELECT participants.profile_summary_text
        FROM participants
        WHERE participants.user_id = chat_participants.user_id
      ),
      profile_updated_at = (
        SELECT participants.profile_updated_at
        FROM participants
        WHERE participants.user_id = chat_participants.user_id
      )
    WHERE profile_summary_text IS NULL
      AND EXISTS (
        SELECT 1
        FROM participants
        WHERE participants.user_id = chat_participants.user_id
          AND participants.profile_summary_text IS NOT NULL
      )
  `);
}

function normalizeDatabaseOpenError(error: unknown, filename: string): Error {
  if (!(error instanceof Error)) {
    return new Error(`Failed to open SQLite database at ${filename}`);
  }

  if (
    error.message.includes("NODE_MODULE_VERSION") ||
    error.message.includes("did not self-register")
  ) {
    return new Error(
      `better-sqlite3 could not open ${filename}. Reinstall dependencies for your current Node.js version and prefer Node 20/22 LTS for this project.`,
      {
        cause: error
      }
    );
  }

  return error;
}
