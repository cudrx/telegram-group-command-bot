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

  test("ignores ordinary mentions and does not call the LLM", async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("не надо"));
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        text: "@fun_bot кто прав?",
        entities: [{ type: "mention", offset: 0, length: 8 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test("replies to command modes with assistant instructions and recent chat context", async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: "до этого был вопрос",
        createdAt: "2026-04-03T12:00:00.000Z"
      })
    );

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("держи"));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const loadAssistantInstructions = vi.fn().mockResolvedValue("assistant instructions");
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      loadAssistantInstructions
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/decide",
        entities: [{ type: "bot_command", offset: 0, length: 7 }]
      })
    );

    expect(loadAssistantInstructions).toHaveBeenCalledWith("config/assistant-instructions.md");
    expect(generateReply).toHaveBeenCalledWith({
      assistantInstructions: "assistant instructions",
      targetDisplayName: "Tom",
      intent: "decide",
      replyContext: expect.objectContaining({
        triggerMessage: expect.objectContaining({ messageId: 2 }),
        replyAnchorMessage: null,
        priorContextMessages: [expect.objectContaining({ messageId: 1 })]
      })
    });
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: "держи"
    });
    expect(db.getMessageByTelegramMessageId(1, 1001)).toMatchObject({
      messageId: 1001,
      text: "держи",
      replyToMessageId: 2,
      isBot: true
    });
  });

  test("formats replies before dispatching and saving bot messages", async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn().mockResolvedValue(
      createReplyResult("<b>Коротко</b>\n\n- пункт\n<script>alert</script>")
    );
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/summarize",
        entities: [{ type: "bot_command", offset: 0, length: 10 }]
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: "<b>Коротко</b>\n\n• пункт\nalert"
    });
    expect(db.getMessageByTelegramMessageId(1, 1001)).toMatchObject({
      messageId: 1001,
      text: "<b>Коротко</b>\n\n• пункт\nalert",
      replyToMessageId: 2,
      isBot: true
    });
  });

  test("logs completed reply jobs at debug level only", async () => {
    const db = new FakeDatabaseClient();
    const logger = createLogger();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("держи"));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      logger
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/summarize",
        entities: [{ type: "bot_command", offset: 0, length: 10 }]
      })
    );

    expect(logger.info).not.toHaveBeenCalledWith(
      "reply_job_completed",
      expect.any(Object)
    );
    expect(logger.debug).toHaveBeenCalledWith(
      "reply_job_completed",
      expect.objectContaining({
        intent: "summarize",
        llmModel: "reply-model"
      })
    );
  });

  test("uses replied-to non-self bot message as explain request anchor", async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        fromUserId: 555,
        fromDisplayName: "Rofl Bot",
        isBot: true,
        text: "кто сильнее лев или тигр?",
        createdAt: "2026-04-03T12:00:00.000Z"
      })
    );

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("тигр вероятнее"));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/explain",
        entities: [{ type: "bot_command", offset: 0, length: 8 }],
        replyToMessageId: 1,
        replyToUserId: 555
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "explain",
        replyContext: expect.objectContaining({
          triggerMessage: expect.objectContaining({ messageId: 2 }),
          replyAnchorMessage: expect.objectContaining({
            messageId: 1,
            isBot: true,
            text: "кто сильнее лев или тигр?"
          })
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: "тигр вероятнее"
    });
  });

  test("uses Telegram reply snapshot as explain anchor when the replied-to bot message is not stored", async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("это ответ другого бота"));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      {
        ...createIncomingMessage({
          messageId: 2,
          text: "/explain",
          entities: [{ type: "bot_command", offset: 0, length: 8 }],
          replyToMessageId: 1,
          replyToUserId: 555
        }),
        replyToMessageSnapshot: {
          chatId: 1,
          messageId: 1,
          userId: 555,
          senderDisplayName: "Rofl Bot (@rofl_bot)",
          text: "кто сильнее лев или тигр?",
          createdAt: "2026-04-03T12:00:00.000Z",
          isBot: true,
          replyToMessageId: null
        }
      } as NormalizedMessage
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "explain",
        replyContext: expect.objectContaining({
          replyAnchorMessage: expect.objectContaining({
            messageId: 1,
            userId: 555,
            isBot: true,
            text: "кто сильнее лев или тигр?"
          })
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: "это ответ другого бота"
    });
  });

  test("returns local explain placeholder when no usable reply anchor exists", async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("не надо"));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/explain кто сильнее лев или тигр",
        entities: [{ type: "bot_command", offset: 0, length: 8 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: "Сделай reply на сообщение с вопросом и отправь /explain."
    });
  });

});

function createOrchestrator(input: {
  db: FakeDatabaseClient;
  qwen: {
    generateReply: (input: {
      assistantInstructions: string;
      targetDisplayName: string;
      intent: "explain" | "summarize" | "decide";
      replyContext: unknown;
    }) => Promise<ReturnType<typeof createReplyResult>>;
  };
  replyDispatcher: (input: {
    chatId: number;
    replyToMessageId: number;
    text: string;
  }) => Promise<{ messageId: number; createdAt: string }>;
  loadAssistantInstructions?: (filePath: string) => Promise<string>;
  logger?: AppLogger;
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
    loadAssistantInstructions:
      input.loadAssistantInstructions ?? vi.fn().mockResolvedValue("assistant instructions"),
    logger: input.logger ?? createLogger(),
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
    logLevel: "info",
    logColor: true,
    sqlitePath: ":memory:",
    assistantInstructionsFile: "config/assistant-instructions.md",
    explainContextLimit: 50,
    summarizeContextLimit: 200,
    decideContextLimit: 100,
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
    replyToMessageSnapshot: null,
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
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn()
  };

  logger.child.mockReturnValue(logger);

  return {
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
    child: logger.child
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
