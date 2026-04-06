import { describe, expect, test, vi } from "vitest";

import { ChatOrchestrator } from "../src/app/chat-orchestrator.js";
import type { AppEnv } from "../src/config/env.js";
import type {
  ChatState,
  ChatType,
  NormalizedMessage,
  ParticipantMemory,
  ParticipantProfile,
  StoredMessage,
  SummaryResult
} from "../src/domain/models.js";
import type {
  LlmClient,
  LlmReplyResult,
  LlmSummaryResult
} from "../src/app/chat-orchestrator.js";
import type { AppLogger, LogFields } from "../src/logging/logger.js";
import type { DatabaseClient } from "../src/storage/database.js";

describe("ChatOrchestrator", () => {
  test("replays a pending reply after the active reply job finishes", async () => {
    const db = new FakeDatabaseClient();
    const deferredReply = createDeferred<LlmReplyResult>();
    const replyDispatcher = vi
      .fn()
      .mockResolvedValueOnce({
        messageId: 1001,
        createdAt: "2026-04-03T12:00:30.000Z"
      })
      .mockResolvedValueOnce({
        messageId: 1002,
        createdAt: "2026-04-03T12:00:45.000Z"
      });
    const generateReply = vi
      .fn()
      .mockImplementationOnce(async () => deferredReply.promise)
      .mockResolvedValueOnce(createReplyResult("второй ответ"));
    const summarizeConversation = vi
      .fn()
      .mockResolvedValue(createSummaryResult("summary"));
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply,
        summarizeConversation
      },
      replyDispatcher
    });

    const firstRun = orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: "@fun_bot ответь",
        entities: [{ type: "mention", offset: 0, length: 8 }]
      })
    );

    await flushMicrotasks();

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "@fun_bot и мне тоже",
        entities: [{ type: "mention", offset: 0, length: 8 }]
      })
    );

    deferredReply.resolve(createReplyResult("первый ответ"));

    await firstRun;

    expect(generateReply).toHaveBeenCalledTimes(2);
    expect(replyDispatcher).toHaveBeenCalledTimes(2);
    expect(replyDispatcher.mock.calls[0]?.[0]).toMatchObject({
      chatId: 1,
      replyToMessageId: 1,
      text: "первый ответ"
    });
    expect(replyDispatcher.mock.calls[1]?.[0]).toMatchObject({
      chatId: 1,
      replyToMessageId: 2,
      text: "второй ответ"
    });

    const secondCallMessages =
      generateReply.mock.calls[1]?.[0]?.recentMessages as StoredMessage[] | undefined;

    expect(secondCallMessages?.map((message) => message.messageId)).toContain(2);
  });

  test("defers summary work while a reply job is active and runs it afterwards", async () => {
    const db = new FakeDatabaseClient();
    const deferredReply = createDeferred<LlmReplyResult>();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const generateReply = vi
      .fn()
      .mockImplementationOnce(async () => deferredReply.promise);
    const summarizeConversation = vi
      .fn()
      .mockResolvedValue(createSummaryResult("обновлённая выжимка"));
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply,
        summarizeConversation
      },
      replyDispatcher,
      now: () => "2026-04-03T13:00:00.000Z",
      env: {
        ...createEnv(),
        chatIdleMinutes: 15,
        minMessagesForSummary: 2
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: "обычное сообщение",
        createdAt: "2026-04-03T12:00:00.000Z"
      })
    );
    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "ещё одно",
        createdAt: "2026-04-03T12:01:00.000Z"
      })
    );

    const replyRun = orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 3,
        text: "@fun_bot расскажи",
        createdAt: "2026-04-03T12:02:00.000Z",
        entities: [{ type: "mention", offset: 0, length: 8 }]
      })
    );

    await flushMicrotasks();
    await orchestrator.runIdleSummarySweep();

    expect(summarizeConversation).not.toHaveBeenCalled();

    deferredReply.resolve(createReplyResult("держи ответ"));

    await replyRun;

    expect(summarizeConversation).toHaveBeenCalledTimes(1);
    expect(db.getChatState(1)?.summaryText).toBe("обновлённая выжимка");
  });

  test("passes self-memory of the bot into reply generation", async () => {
    const db = new FakeDatabaseClient();

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: "обычное сообщение"
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 2,
      text: "я уже тут",
      createdAt: "2026-04-03T12:00:30.000Z",
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
          }
        ]
      },
      2,
      "2026-04-03T12:05:00.000Z",
      {
        userId: 77,
        username: "fun_bot",
        displayName: "Fun Bot"
      }
    );

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("держи"));
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply,
        summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
      },
      replyDispatcher: vi.fn().mockResolvedValue({
        messageId: 1002,
        createdAt: "2026-04-03T12:06:00.000Z"
      })
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 3,
        text: "@fun_bot давай",
        entities: [{ type: "mention", offset: 0, length: 8 }]
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        selfMemoryContext: expect.stringContaining("running_joke_with_tom: часто шутит про дедлайны с Томом")
      })
    );
  });

  test("loads persona with chat-specific context for the current chat", async () => {
    const db = new FakeDatabaseClient();
    const loadPersona = vi.fn().mockResolvedValue("persona");
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult("держи")),
        summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
      },
      replyDispatcher: vi.fn().mockResolvedValue({
        messageId: 1003,
        createdAt: "2026-04-03T12:07:00.000Z"
      }),
      loadPersona
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        chatId: 777,
        messageId: 1,
        text: "@fun_bot давай",
        entities: [{ type: "mention", offset: 0, length: 8 }]
      })
    );

    expect(loadPersona).toHaveBeenCalledWith("config/persona.md", 777);
  });
});

function createOrchestrator(input: {
  db: FakeDatabaseClient;
  qwen: LlmClient;
  replyDispatcher: ReturnType<typeof vi.fn>;
  env?: AppEnv;
  loadPersona?: (filePath: string, chatId?: number) => Promise<string>;
  now?: () => string;
}): ChatOrchestrator {
  return new ChatOrchestrator({
    db: input.db as unknown as DatabaseClient,
    qwen: input.qwen,
    env: input.env ?? createEnv(),
    bot: {
      userId: 77,
      username: "fun_bot",
      displayName: "Fun Bot"
    },
    replyDispatcher: input.replyDispatcher,
    loadPersona:
      input.loadPersona ??
      (async (_filePath: string, _chatId?: number) => "ты весёлый персонаж"),
    logger: createNoopLogger(),
    random: () => 0,
    now: input.now ?? (() => "2026-04-03T12:10:00.000Z")
  });
}

function createEnv(): AppEnv {
  return {
    nodeEnv: "test",
    telegramBotToken: "telegram-token",
    llmApiKey: "llm-key",
    llmBaseUrl: "https://example.invalid/v1",
    llmReplyModel: "reply-model",
    llmSummaryModel: "summary-model",
    llmSummaryJsonMode: "response_format",
    llmTimeoutMs: 20_000,
    llmMaxRetries: 1,
    logLlmText: false,
    sqlitePath: "data/test.sqlite",
    personaFile: "config/persona.md",
    interjectProbability: 0,
    interjectCooldownMinutes: 30,
    chatIdleMinutes: 30,
    minMessagesForSummary: 10,
    messageContextLimit: 16,
    summarySweepIntervalMs: 60_000,
    messageRetentionDays: 180
  };
}

function createIncomingMessage(input: {
  messageId: number;
  text: string;
  createdAt?: string;
  chatId?: number;
  chatType?: ChatType;
  entities?: Array<{ type: string; offset: number; length: number }>;
}): NormalizedMessage {
  return {
    chatId: input.chatId ?? 1,
    chatType: input.chatType ?? "group",
    chatTitle: "Friends",
    messageId: input.messageId,
    text: input.text,
    createdAt: input.createdAt ?? "2026-04-03T12:00:00.000Z",
    fromUserId: 42,
    fromUsername: "tom",
    fromFirstName: "Tom",
    fromDisplayName: "Tom",
    isBot: false,
    entities: input.entities ?? [],
    replyToUserId: null
  };
}

function createReplyResult(text: string): LlmReplyResult {
  return {
    text,
    model: "reply-model",
    latencyMs: 25,
    attemptCount: 1,
    promptTokensEstimate: 42
  };
}

function createSummaryResult(chatSummary: string): LlmSummaryResult {
  return {
    result: {
      chatSummary,
      memoryUpdates: [],
      selfMemoryUpdates: []
    },
    model: "summary-model",
    latencyMs: 30,
    attemptCount: 1,
    promptTokensEstimate: 55
  };
}

function createNoopLogger(): AppLogger {
  return {
    child(fields: LogFields) {
      void fields;
      return createNoopLogger();
    },
    info() {},
    warn() {},
    error() {}
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    resolve,
    reject
  };
}

class FakeDatabaseClient {
  private readonly chats = new Map<number, ChatState>();
  private readonly messages = new Map<number, StoredMessage[]>();
  private readonly profiles = new Map<string, ParticipantProfile>();
  private readonly memories = new Map<string, ParticipantMemory[]>();

  saveIncomingMessage(message: NormalizedMessage): boolean {
    const chat = this.ensureChat(message.chatId, message.chatType, message.chatTitle);
    const storedMessages = this.messages.get(message.chatId) ?? [];

    if (storedMessages.some((stored) => stored.messageId === message.messageId)) {
      return false;
    }

    storedMessages.push({
      chatId: message.chatId,
      messageId: message.messageId,
      userId: message.fromUserId,
      senderDisplayName: message.fromDisplayName,
      text: message.text,
      createdAt: message.createdAt,
      isBot: message.isBot
    });
    this.messages.set(message.chatId, storedMessages);
    chat.lastMessageAt = message.createdAt;
    chat.unsummarizedMessageCount += 1;

    if (message.fromUserId !== null) {
      const key = this.getProfileKey(message.chatId, message.fromUserId);

      this.profiles.set(key, {
        chatId: message.chatId,
        userId: message.fromUserId,
        username: message.fromUsername,
        displayName: message.fromDisplayName,
        profileSummaryText: this.profiles.get(key)?.profileSummaryText ?? null,
        profileUpdatedAt: this.profiles.get(key)?.profileUpdatedAt ?? null
      });
    }

    return true;
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
    const chat = this.ensureChat(input.chatId, input.chatType as ChatType, input.chatTitle);
    const storedMessages = this.messages.get(input.chatId) ?? [];

    this.profiles.set(this.getProfileKey(input.chatId, input.userId), {
      chatId: input.chatId,
      userId: input.userId,
      username: input.username,
      displayName: input.displayName,
      profileSummaryText: this.profiles.get(this.getProfileKey(input.chatId, input.userId))
        ?.profileSummaryText ?? null,
      profileUpdatedAt: this.profiles.get(this.getProfileKey(input.chatId, input.userId))
        ?.profileUpdatedAt ?? null
    });

    storedMessages.push({
      chatId: input.chatId,
      messageId: input.messageId,
      userId: input.userId,
      senderDisplayName: input.displayName,
      text: input.text,
      createdAt: input.createdAt,
      isBot: true
    });
    this.messages.set(input.chatId, storedMessages);
    chat.lastMessageAt = input.createdAt;
    chat.lastBotMessageAt = input.createdAt;
    chat.unsummarizedMessageCount += 1;
  }

  getChatState(chatId: number): ChatState | null {
    return this.cloneChat(this.chats.get(chatId) ?? null);
  }

  listSummaryCandidates(): ChatState[] {
    return Array.from(this.chats.values()).map((chat) => this.cloneChat(chat)!);
  }

  runMaintenance(input: {
    now: string;
    messageRetentionDays: number;
    minMessagesToKeep: number;
  }): void {
    void input;
  }

  runChatMaintenance(input: {
    chatId: number;
    now: string;
    messageRetentionDays: number;
    minMessagesToKeep: number;
  }): void {
    void input;
  }

  getParticipantProfile(chatId: number, userId: number): ParticipantProfile | null {
    const profile = this.profiles.get(this.getProfileKey(chatId, userId)) ?? null;

    return profile ? { ...profile } : null;
  }

  getParticipantMemoryContext(chatId: number, userId: number): string | null {
    return this.getParticipantProfile(chatId, userId)?.profileSummaryText ?? null;
  }

  getRecentMessages(chatId: number, limit: number): StoredMessage[] {
    const storedMessages = this.messages.get(chatId) ?? [];

    return storedMessages.slice(-limit).map((message) => ({ ...message }));
  }

  getMessagesSince(chatId: number, telegramMessageId: number): StoredMessage[] {
    return (this.messages.get(chatId) ?? [])
      .filter((message) => message.messageId > telegramMessageId)
      .map((message) => ({ ...message }));
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
    const chat = this.chats.get(chatId);

    if (!chat) {
      return;
    }

    chat.summaryText = result.chatSummary;
    chat.summaryUpdatedAt = updatedAt;
    chat.summaryCursorMessageId = appliedThroughMessageId;
    chat.unsummarizedMessageCount = this.getMessagesSince(chatId, appliedThroughMessageId).length;

    for (const update of result.memoryUpdates) {
      this.applyMemoryUpdate(chatId, update.userId, update, updatedAt);
    }

    if (botIdentity) {
      this.profiles.set(this.getProfileKey(chatId, botIdentity.userId), {
        chatId,
        userId: botIdentity.userId,
        username: botIdentity.username,
        displayName: botIdentity.displayName,
        profileSummaryText: this.profiles.get(this.getProfileKey(chatId, botIdentity.userId))
          ?.profileSummaryText ?? null,
        profileUpdatedAt: this.profiles.get(this.getProfileKey(chatId, botIdentity.userId))
          ?.profileUpdatedAt ?? null
      });

      for (const update of result.selfMemoryUpdates) {
        this.applyMemoryUpdate(chatId, botIdentity.userId, update, updatedAt);
      }
    }
  }

  close(): void {}

  private ensureChat(chatId: number, chatType: ChatType, chatTitle: string | null): ChatState {
    const existing = this.chats.get(chatId);

    if (existing) {
      existing.chatType = chatType;
      existing.title = chatTitle;

      return existing;
    }

    const created: ChatState = {
      chatId,
      chatType,
      title: chatTitle,
      lastMessageAt: null,
      lastBotMessageAt: null,
      summaryText: null,
      summaryUpdatedAt: null,
      summaryCursorMessageId: 0,
      unsummarizedMessageCount: 0
    };

    this.chats.set(chatId, created);

    return created;
  }

  private cloneChat(chat: ChatState | null): ChatState | null {
    return chat ? { ...chat } : null;
  }

  private getProfileKey(chatId: number, userId: number): string {
    return `${chatId}:${userId}`;
  }

  private applyMemoryUpdate(
    chatId: number,
    userId: number,
    update: SummaryResult["memoryUpdates"][number] | SummaryResult["selfMemoryUpdates"][number],
    updatedAt: string
  ): void {
    const profileKey = this.getProfileKey(chatId, userId);
    const existing = this.profiles.get(profileKey);

    if (!existing) {
      return;
    }

    const memoryKey = this.getProfileKey(chatId, userId);
    const currentMemories = this.memories.get(memoryKey) ?? [];
    const filteredMemories =
      update.cardinality === "single"
        ? currentMemories.filter((memory) => memory.key !== update.key)
        : currentMemories;
    const nextMemory: ParticipantMemory = {
      memoryId: filteredMemories.length + 1,
      chatId,
      userId,
      category: update.category,
      key: update.key,
      valueText: update.valueText,
      valueNormalized: update.valueText.toLowerCase(),
      stability: update.stability,
      sourceKind: update.sourceKind,
      confidence: update.confidence,
      cardinality: update.cardinality,
      status: "active",
      isPinned: false,
      firstSeenAt: updatedAt,
      lastSeenAt: updatedAt,
      lastConfirmedAt: updatedAt,
      expiresAt: null,
      supersedesMemoryId: null
    };

    this.memories.set(memoryKey, [...filteredMemories, nextMemory]);
    this.profiles.set(profileKey, {
      ...existing,
      profileSummaryText: this.memories
        .get(memoryKey)
        ?.map((memory) => `[${memory.stability}] ${memory.key}: ${memory.valueText}`)
        .join("; ") ?? null,
      profileUpdatedAt: updatedAt
    });
  }
}
