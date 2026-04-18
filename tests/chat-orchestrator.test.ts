import { describe, expect, test, vi } from "vitest";

import { ChatOrchestrator } from "../src/app/chat-orchestrator.js";
import type { AppEnv } from "../src/config/env.js";
import type { ChatState, NormalizedMessage, StoredMessage } from "../src/domain/models.js";
import type { LookupProvider } from "../src/lookup/types.js";
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
      lookupContext: null,
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

  test("does not plan lookup for summarize", async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("коротко"));
    const planLookup = vi.fn().mockResolvedValue(createLookupPlanResult({
      shouldLookup: true,
      purpose: "entity_grounding",
      reason: "Should not be called for summarize.",
      queries: ["ignored"],
      confidence: "high"
    }));
    const lookupProvider = {
      search: vi.fn().mockResolvedValue({
        provider: "tavily",
        query: "ignored",
        sources: [],
        responseTimeMs: 1,
        usageCredits: 1
      })
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/summarize",
        entities: [{ type: "bot_command", offset: 0, length: 10 }]
      })
    );

    expect(planLookup).not.toHaveBeenCalled();
    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "summarize",
        lookupContext: null
      })
    );
  });

  test("does not plan lookup when lookup is disabled", async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("вердикт"));
    const planLookup = vi.fn();
    const lookupProvider = {
      search: vi.fn()
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: false }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/decide",
        entities: [{ type: "bot_command", offset: 0, length: 7 }]
      })
    );

    expect(planLookup).not.toHaveBeenCalled();
    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "decide",
        lookupContext: null
      })
    );
  });

  test("plans and uses Tavily lookup for decide when planner requests it", async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: "кто лучше дора или мейби бэйби?",
        createdAt: "2026-04-03T12:00:00.000Z"
      })
    );

    const decision = {
      shouldLookup: true,
      purpose: "entity_grounding" as const,
      reason: "Need to identify the artists.",
      queries: ["Дора Мэйби Бэйби певицы кто такие"],
      confidence: "high" as const
    };
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("вердикт"));
    const planLookup = vi.fn().mockResolvedValue(createLookupPlanResult(decision));
    const lookupProvider = {
      search: vi.fn().mockResolvedValue({
        provider: "tavily",
        query: "Дора Мэйби Бэйби певицы кто такие",
        sources: [
          {
            title: "Дора (певица)",
            url: "https://example.com/dora",
            content: "Дора - российская певица.",
            score: 0.91
          }
        ],
        responseTimeMs: 321,
        usageCredits: 1
      })
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: {
        lookupEnabled: true,
        lookupMaxResults: 3,
        lookupTimeoutMs: 7000
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/decide",
        entities: [{ type: "bot_command", offset: 0, length: 7 }]
      })
    );

    expect(planLookup).toHaveBeenCalledWith({
      intent: "decide",
      replyContext: expect.objectContaining({
        priorContextMessages: [expect.objectContaining({ messageId: 1 })]
      })
    });
    expect(lookupProvider.search).toHaveBeenCalledWith({
      query: "Дора Мэйби Бэйби певицы кто такие",
      maxResults: 3,
      timeoutMs: 7000
    });
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "decide",
        lookupContext: expect.objectContaining({
          status: "used",
          provider: "tavily",
          query: "Дора Мэйби Бэйби певицы кто такие",
          sources: [
            expect.objectContaining({
              title: "Дора (певица)",
              url: "https://example.com/dora"
            })
          ]
        })
      })
    );
  });

  test("passes failed lookup context to final reply when Tavily fails", async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: "кто лучше дора или мейби бэйби?",
        createdAt: "2026-04-03T12:00:00.000Z"
      })
    );

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("вердикт"));
    const planLookup = vi.fn().mockResolvedValue(createLookupPlanResult({
      shouldLookup: true,
      purpose: "entity_grounding",
      reason: "Need to identify the artists.",
      queries: ["Дора Мэйби Бэйби певицы кто такие"],
      confidence: "high"
    }));
    const lookupProvider = {
      search: vi.fn().mockRejectedValue(new Error("network down"))
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/decide",
        entities: [{ type: "bot_command", offset: 0, length: 7 }]
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupContext: expect.objectContaining({
          status: "failed",
          errorMessage: "network down"
        })
      })
    );
  });

  test("continues with failed lookup context when planner fails", async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("вердикт без поиска"));
    const planLookup = vi.fn().mockRejectedValue(new Error("planner quota"));
    const lookupProvider = {
      search: vi.fn()
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/decide",
        entities: [{ type: "bot_command", offset: 0, length: 7 }]
      })
    );

    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupContext: expect.objectContaining({
          status: "failed",
          provider: null,
          query: null,
          errorMessage: "planner quota"
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: "вердикт без поиска"
    });
  });

  test("continues with failed lookup context when planner output is malformed", async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("вердикт без поиска"));
    const planLookup = vi.fn().mockResolvedValue({
      status: "failed",
      decision: {
        shouldLookup: false,
        purpose: "none",
        reason: "Lookup planner returned invalid JSON.",
        queries: [],
        confidence: "low"
      },
      model: "planner-model",
      latencyMs: 5,
      attemptCount: 1,
      promptTokensEstimate: 30
    });
    const lookupProvider = {
      search: vi.fn()
    };
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply, planLookup },
      replyDispatcher,
      lookupProvider,
      env: { lookupEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/decide",
        entities: [{ type: "bot_command", offset: 0, length: 7 }]
      })
    );

    expect(lookupProvider.search).not.toHaveBeenCalled();
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupContext: expect.objectContaining({
          status: "failed",
          provider: null,
          query: null,
          errorMessage: "Lookup planner returned invalid JSON."
        })
      })
    );
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
      lookupContext?: unknown;
    }) => Promise<ReturnType<typeof createReplyResult>>;
    planLookup?: (input: {
      intent: "explain" | "decide";
      replyContext: unknown;
    }) => Promise<ReturnType<typeof createLookupPlanResult>>;
  };
  replyDispatcher: (input: {
    chatId: number;
    replyToMessageId: number;
    text: string;
  }) => Promise<{ messageId: number; createdAt: string }>;
  lookupProvider?: LookupProvider | null;
  env?: Partial<AppEnv>;
  loadAssistantInstructions?: (filePath: string) => Promise<string>;
  logger?: AppLogger;
}): ChatOrchestrator {
  return new ChatOrchestrator({
    db: input.db as never,
    qwen: {
      ...input.qwen,
      planLookup:
        input.qwen.planLookup ??
        vi.fn().mockResolvedValue(createLookupPlanResult({
          shouldLookup: false,
          purpose: "none",
          reason: "No lookup needed.",
          queries: [],
          confidence: "low"
        }))
    },
    lookupProvider: input.lookupProvider ?? null,
    env: createEnv(input.env),
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

function createEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    nodeEnv: "test",
    telegramBotToken: "telegram-token",
    llmApiKey: "llm-key",
    llmBaseUrl: "https://example.com",
    llmReplyModel: "reply-model",
    llmFastReplyModel: "fast-reply-model",
    llmReplyTemperature: 0.6,
    llmReplyEnableThinking: false,
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
    replyTypingRefreshMs: 4000,
    llmPlannerModel: "planner-model",
    lookupEnabled: false,
    lookupProvider: "tavily",
    tavilyApiKey: null,
    lookupTimeoutMs: 7000,
    lookupMaxQueries: 1,
    lookupMaxResults: 3,
    deployNotifyChatId: -1002155313986,
    ...overrides
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

function createLookupPlanResult(decision: {
  shouldLookup: boolean;
  purpose: "none" | "entity_grounding" | "fact_check" | "freshness" | "link_extraction";
  reason: string;
  queries: string[];
  confidence: "high" | "medium" | "low";
}) {
  return {
    status: "ok" as const,
    decision,
    model: "planner-model",
    latencyMs: 5,
    attemptCount: 1,
    promptTokensEstimate: 30
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
