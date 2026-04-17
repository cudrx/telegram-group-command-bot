import { describe, expect, test, vi } from "vitest";

import { ChatOrchestrator } from "../src/app/chat-orchestrator.js";
import type { AppEnv } from "../src/config/env.js";
import type { ChatState, NormalizedMessage, StoredMessage } from "../src/domain/models.js";
import type { AppLogger, LogFields } from "../src/logging/logger.js";

describe("ChatOrchestrator", () => {
  test("ignores ordinary messages and does not call the LLM", async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("не надо"));
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(createIncomingMessage({ text: "обычно болтаем" }));

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test("replies to mentions with base persona and local context only", async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("держи"));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const loadPersona = vi.fn().mockResolvedValue("persona");
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      loadPersona
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: "@fun_bot ответь",
        entities: [{ type: "mention", offset: 0, length: 8 }]
      })
    );

    expect(loadPersona).toHaveBeenCalledWith("config/persona.md");
    expect(generateReply).toHaveBeenCalledWith({
      persona: "persona",
      targetDisplayName: "Tom",
      reason: "mention",
      replyContext: expect.objectContaining({
        triggerMessage: expect.objectContaining({ messageId: 1 }),
        anchorBotMessage: null,
        anchorParentMessage: null
      })
    });
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 1,
      text: "держи"
    });
    expect(db.getMessageByTelegramMessageId(1, 1001)).toMatchObject({
      messageId: 1001,
      text: "держи",
      replyToMessageId: 1,
      isBot: true
    });
  });

  test("passes causal reply context for replies to the bot", async () => {
    const db = new FakeDatabaseClient();

    db.saveIncomingMessage(createIncomingMessage({ messageId: 10, text: "ну чо" }));
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 11,
      text: "кривой ответ",
      createdAt: "2026-04-10T12:00:05.000Z",
      userId: 77,
      username: "fun_bot",
      displayName: "Хрюпа",
      replyToMessageId: 10
    });

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("понял"));
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher: vi.fn().mockResolvedValue({
        messageId: 1002,
        createdAt: "2026-04-10T12:00:20.000Z"
      })
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 12,
        text: "почему кот",
        replyToUserId: 77,
        replyToMessageId: 11
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "reply_to_bot",
        replyContext: expect.objectContaining({
          triggerMessage: expect.objectContaining({ messageId: 12 }),
          anchorBotMessage: expect.objectContaining({ messageId: 11 }),
          anchorParentMessage: expect.objectContaining({ messageId: 10 }),
          priorContextMessages: [expect.objectContaining({ messageId: 10 })]
        })
      })
    );
  });

  test("sanitizes repeated bot anchors before calling the LLM", async () => {
    const db = new FakeDatabaseClient();

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 100,
        text: "Можешь хрюкнуть?",
        fromDisplayName: "Артур",
        createdAt: "2026-04-14T12:00:00.000Z"
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 101,
      text: "хрю-хрю, дерьмишко на поезде",
      createdAt: "2026-04-14T12:00:01.000Z",
      userId: 77,
      username: "fun_bot",
      displayName: "Хрюпа",
      replyToMessageId: 100
    });
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 102,
        text: "еще раз",
        fromDisplayName: "Артур",
        replyToUserId: 77,
        replyToMessageId: 101,
        createdAt: "2026-04-14T12:00:02.000Z"
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 103,
      text: "опять дерьмишко на поезде, хрю-хрю",
      createdAt: "2026-04-14T12:00:03.000Z",
      userId: 77,
      username: "fun_bot",
      displayName: "Хрюпа",
      replyToMessageId: 102
    });

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("приторможу"));
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher: vi.fn().mockResolvedValue({
        messageId: 1009,
        createdAt: "2026-04-14T12:00:05.000Z"
      })
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        messageId: 104,
        text: "Сука",
        fromDisplayName: "Артур",
        replyToUserId: 77,
        replyToMessageId: 103,
        createdAt: "2026-04-14T12:00:04.000Z"
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyContext: expect.objectContaining({
          triggerMessage: expect.objectContaining({ text: "Сука" }),
          anchorBotMessage: expect.objectContaining({
            messageId: 103,
            text: "[previous bot reply omitted because it appears repetitive]"
          })
        })
      })
    );
  });

  test("calls the llm with an omitted repeated anchor for repeated reply chains", async () => {
    const db = new FakeDatabaseClient();

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 100,
        text: "@fun_bot они тебя обижают?",
        entities: [{ type: "mention", offset: 0, length: 8 }],
        createdAt: "2026-04-13T08:59:57.000Z"
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 101,
      text: "ну ты и говно, да\nа я тут просто сижу, как винтик в дыре",
      createdAt: "2026-04-13T08:59:58.000Z",
      userId: 77,
      username: "fun_bot",
      displayName: "Fun Bot",
      replyToMessageId: 100
    });
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 102,
        text: "Ты анальная пробка?",
        replyToUserId: 77,
        replyToMessageId: 101,
        createdAt: "2026-04-13T08:59:59.000Z"
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 103,
      text: "ну ты и говно, да\nа я тут просто сижу, как винтик в дыре",
      createdAt: "2026-04-13T09:00:00.000Z",
      userId: 77,
      username: "fun_bot",
      displayName: "Fun Bot",
      replyToMessageId: 102
    });

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("сейчас нормально отвечу"));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1008,
      createdAt: "2026-04-13T09:00:11.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 104,
        text: "Ты анальная пробка?",
        replyToUserId: 77,
        replyToMessageId: 103,
        createdAt: "2026-04-13T09:00:10.000Z"
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyContext: expect.objectContaining({
          triggerMessage: expect.objectContaining({ text: "Ты анальная пробка?" }),
          anchorBotMessage: expect.objectContaining({
            messageId: 103,
            text: "[previous bot reply omitted because it appears repetitive or unsafe to copy]"
          })
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToMessageId: 104,
        text: "сейчас нормально отвечу"
      })
    );
  });

  test("retries once when the first generated reply duplicates recent bot text", async () => {
    const db = new FakeDatabaseClient();

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        text: "@fun_bot пользуешься впн?",
        entities: [{ type: "mention", offset: 0, length: 8 }],
        createdAt: "2026-04-17T09:09:28.000Z"
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 11,
      text: "а ты чё, вдруг решил проверить, кто тут с впн, а кто без?",
      createdAt: "2026-04-17T09:09:30.000Z",
      userId: 77,
      username: "fun_bot",
      displayName: "Хрюпа",
      replyToMessageId: 10
    });

    const generateReply = vi
      .fn()
      .mockResolvedValueOnce(
        createReplyResult("а ты чё, вдруг решил проверить, кто тут с впн, а кто без?")
      )
      .mockResolvedValueOnce(createReplyResult("ладно, отвечу прямо: нет, сейчас без него"));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1009,
      createdAt: "2026-04-17T09:10:21.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 12,
        text: "а ты что еврей вопросом на вопрос отвечать?",
        replyToUserId: 77,
        replyToMessageId: 11,
        createdAt: "2026-04-17T09:10:18.000Z"
      })
    );

    expect(generateReply).toHaveBeenCalledTimes(2);
    expect(generateReply).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        duplicateReplyRecovery: true
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 12,
      text: "ладно, отвечу прямо: нет, сейчас без него"
    });
  });

  test("skips the reply when duplicate recovery also duplicates recent bot text", async () => {
    const db = new FakeDatabaseClient();

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        text: "@fun_bot пользуешься впн?",
        entities: [{ type: "mention", offset: 0, length: 8 }],
        createdAt: "2026-04-17T09:09:28.000Z"
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 11,
      text: "а ты чё, вдруг решил проверить, кто тут с впн, а кто без?",
      createdAt: "2026-04-17T09:09:30.000Z",
      userId: 77,
      username: "fun_bot",
      displayName: "Хрюпа",
      replyToMessageId: 10
    });

    const generateReply = vi
      .fn()
      .mockResolvedValueOnce(
        createReplyResult("а ты чё, вдруг решил проверить, кто тут с впн, а кто без?")
      )
      .mockResolvedValueOnce(
        createReplyResult("а ты чё, вдруг решил проверить, кто тут с впн, а кто без?")
      );
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 12,
        text: "а ты что еврей вопросом на вопрос отвечать?",
        replyToUserId: 77,
        replyToMessageId: 11,
        createdAt: "2026-04-17T09:10:18.000Z"
      })
    );

    expect(generateReply).toHaveBeenCalledTimes(2);
    expect(replyDispatcher).not.toHaveBeenCalled();
  });
});

function createOrchestrator(input: {
  db: FakeDatabaseClient;
  qwen: {
    generateReply: (input: {
      persona: string;
      targetDisplayName: string;
      reason: string;
      replyContext: unknown;
      duplicateReplyRecovery?: boolean;
    }) => Promise<ReturnType<typeof createReplyResult>>;
  };
  replyDispatcher: (input: {
    chatId: number;
    replyToMessageId: number;
    text: string;
  }) => Promise<{ messageId: number; createdAt: string }>;
  loadPersona?: (filePath: string) => Promise<string>;
}): ChatOrchestrator {
  return new ChatOrchestrator({
    db: input.db as never,
    qwen: input.qwen,
    env: createEnv(),
    bot: {
      userId: 77,
      username: "fun_bot",
      displayName: "Fun Bot"
    },
    replyDispatcher: input.replyDispatcher,
    sendTyping: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
    loadPersona: input.loadPersona ?? vi.fn().mockResolvedValue("persona"),
    logger: createLogger(),
    random: () => 0,
    now: () => "2026-04-13T09:00:10.000Z"
  });
}

function createEnv(): AppEnv {
  return {
    nodeEnv: "test",
    telegramBotToken: "telegram-token",
    llmApiKey: "llm-key",
    llmBaseUrl: "https://example.com",
    llmReplyModel: "reply-model",
    llmReplyTemperature: 0.6,
    llmTimeoutMs: 20_000,
    llmMaxRetries: 1,
    logLlmText: false,
    sqlitePath: ":memory:",
    personaFile: "config/persona.md",
    messageContextLimit: 8,
    replyToBotLoopCooldownMs: 15_000,
    replyToBotMinIntervalMs: 0,
    replyRecentBotMessagesForGuard: 8,
    replyMinTypingMs: 0,
    replyMaxTypingMs: 0,
    replyTypingRefreshMs: 4000
  };
}

function createIncomingMessage(
  overrides: Partial<NormalizedMessage> = {}
): NormalizedMessage {
  return {
    chatId: 1,
    chatType: "group",
    chatTitle: "Friends",
    messageId: 1,
    text: "обычное сообщение",
    createdAt: "2026-04-03T12:00:00.000Z",
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

function createReplyResult(text: string) {
  return {
    text,
    model: "reply-model",
    latencyMs: 10,
    attemptCount: 1,
    promptTokensEstimate: 20
  };
}

function createLogger(): AppLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn((_fields: LogFields) => createLogger())
  };
}

class FakeDatabaseClient {
  private readonly messages = new Map<number, StoredMessage[]>();
  private readonly chats = new Map<number, ChatState>();

  saveIncomingMessage(message: NormalizedMessage): boolean {
    const chat = this.getOrCreateChat(message);

    chat.lastMessageAt = message.createdAt;
    this.chats.set(message.chatId, chat);

    return this.insertMessage({
      chatId: message.chatId,
      messageId: message.messageId,
      userId: message.fromUserId,
      senderDisplayName: message.fromDisplayName,
      text: message.text,
      createdAt: message.createdAt,
      isBot: message.isBot,
      replyToMessageId: message.replyToMessageId
    });
  }

  saveBotMessage(input: {
    chatId: number;
    chatType: string;
    chatTitle: string | null;
    messageId: number;
    text: string;
    createdAt: string;
    userId: number;
    username?: string | null;
    displayName: string;
    replyToMessageId?: number | null;
  }): void {
    const chat = this.getOrCreateChat({
      chatId: input.chatId,
      chatType: input.chatType as NormalizedMessage["chatType"],
      chatTitle: input.chatTitle,
      createdAt: input.createdAt
    });

    chat.lastMessageAt = input.createdAt;
    chat.lastBotMessageAt = input.createdAt;
    this.chats.set(input.chatId, chat);
    this.insertMessage({
      chatId: input.chatId,
      messageId: input.messageId,
      userId: input.userId,
      senderDisplayName: input.displayName,
      text: input.text,
      createdAt: input.createdAt,
      isBot: true,
      replyToMessageId: input.replyToMessageId ?? null
    });
  }

  getChatState(chatId: number): ChatState | null {
    const chat = this.chats.get(chatId);

    return chat ? { ...chat } : null;
  }

  getMessagesBefore(chatId: number, beforeMessageId: number, limit: number): StoredMessage[] {
    return (this.messages.get(chatId) ?? [])
      .filter((message) => message.messageId < beforeMessageId)
      .slice(-limit)
      .map((message) => ({ ...message }));
  }

  getMessageByTelegramMessageId(chatId: number, messageId: number): StoredMessage | null {
    const message = (this.messages.get(chatId) ?? []).find(
      (candidate) => candidate.messageId === messageId
    );

    return message ? { ...message } : null;
  }

  private insertMessage(message: StoredMessage): boolean {
    const messages = this.messages.get(message.chatId) ?? [];

    if (messages.some((existing) => existing.messageId === message.messageId)) {
      return false;
    }

    messages.push({ ...message });
    messages.sort((left, right) => left.messageId - right.messageId);
    this.messages.set(message.chatId, messages);

    return true;
  }

  private getOrCreateChat(input: {
    chatId: number;
    chatType: NormalizedMessage["chatType"];
    chatTitle: string | null;
    createdAt: string;
  }): ChatState {
    return (
      this.chats.get(input.chatId) ?? {
        chatId: input.chatId,
        chatType: input.chatType,
        title: input.chatTitle,
        lastMessageAt: input.createdAt,
        lastBotMessageAt: null
      }
    );
  }
}
