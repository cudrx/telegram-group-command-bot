import { describe, expect, test, vi } from "vitest";

import { ChatOrchestrator } from "../src/app/chat-orchestrator.js";
import type { AppEnv } from "../src/config/env.js";
import type {
  ParticipantAliasRecord,
  ChatState,
  ChatType,
  NormalizedMessage,
  ParticipantMemory,
  ParticipantProfile,
  ResolvedParticipantContext,
  StoredMessage,
  SummaryResult
} from "../src/domain/models.js";
import type {
  LlmClient,
  LlmInterventionAnalysisResult,
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

    const secondCallTriggerMessage =
      generateReply.mock.calls[1]?.[0]?.replyContext?.triggerMessage as
        | StoredMessage
        | undefined;

    expect(secondCallTriggerMessage?.messageId).toBe(2);
  });

  test("retains the original replyToMessageId when storing generated bot replies", async () => {
    const db = new FakeDatabaseClient();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("держи"));
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply,
        summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
      },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: "@fun_bot ответь",
        entities: [{ type: "mention", offset: 0, length: 8 }],
        replyToMessageId: 41
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: 1
      })
    );
    expect(db.getRecentMessages(1, 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: 1001,
          replyToMessageId: 1
        })
      ])
    );
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

  test("does not pass bot self-memory into reply generation", async () => {
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
        memoryUpdates: []
      },
      2,
      "2026-04-03T12:05:00.000Z"
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
        replyContext: expect.any(Object)
      })
    );
    expect(generateReply.mock.calls[0]?.[0]).not.toHaveProperty("selfMemoryContext");
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

  test("returns a clarification reply instead of calling the llm for ambiguous participant names", async () => {
    const db = new FakeDatabaseClient();

    db.seedParticipantAliases(1, "олег", [
      createAliasRecord(1, 42, "Олег", "Олег (@oleg_dev)"),
      createAliasRecord(1, 99, "Олег", "Олег (@oleg_other)")
    ]);

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("не должно вызываться"));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1004,
      createdAt: "2026-04-03T12:08:00.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply,
        summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
      },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: "@fun_bot что между Олегом и Артуром?",
        entities: [{ type: "mention", offset: 0, length: 8 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Олег (@oleg_dev)")
      })
    );
  });

  test("passes resolved participant bundles into reply generation for social questions", async () => {
    const db = new FakeDatabaseClient();

    db.seedParticipantProfile(1, 7, {
      chatId: 1,
      userId: 7,
      username: "artur_dev",
      displayName: "Артур (@artur_dev)",
      profileSummaryText: "[durable] runs_project: true",
      profileUpdatedAt: "2026-04-03T12:00:00.000Z"
    });
    db.seedParticipantAliases(1, "олегом", [
      createAliasRecord(1, 42, "Олег", "Олег (@oleg_dev)")
    ]);
    db.seedParticipantAliases(1, "артуром", [
      createAliasRecord(1, 7, "Артур", "Артур (@artur_dev)")
    ]);

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("держи"));
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply,
        summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
      },
      replyDispatcher: vi.fn().mockResolvedValue({
        messageId: 1005,
        createdAt: "2026-04-03T12:09:00.000Z"
      })
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 3,
        text: "@fun_bot что между Олегом и Артуром?",
        entities: [{ type: "mention", offset: 0, length: 8 }]
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        socialIntent: true,
        socialIntentReason: "relationship_question",
        resolvedParticipants: [
          { userId: 42, displayName: "Олег (@oleg_dev)" },
          { userId: 7, displayName: "Артур (@artur_dev)" }
        ],
        socialParticipantContexts: [
          {
            userId: 42,
            displayName: "Олег (@oleg_dev)",
            participantMemoryContext: null
          },
          {
            userId: 7,
            displayName: "Артур (@artur_dev)",
            participantMemoryContext: "[durable] runs_project: true"
          }
        ]
      })
    );
  });

  test("passes participant description requests through the social QA context path", async () => {
    const db = new FakeDatabaseClient();

    db.seedParticipantAliases(1, "хачика", [
      createAliasRecord(1, 126, "Хачик", "Хачик (@loudsplash)")
    ]);

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("пока не раскусил"));
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply,
        summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
      },
      replyDispatcher: vi.fn().mockResolvedValue({
        messageId: 1006,
        createdAt: "2026-04-03T12:10:00.000Z"
      })
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 4,
        text: "@fun_bot опиши Хачика",
        entities: [{ type: "mention", offset: 0, length: 8 }]
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        socialIntent: true,
        socialIntentReason: "participant_description_request",
        resolvedParticipants: [
          { userId: 126, displayName: "Хачик (@loudsplash)" }
        ],
        socialParticipantContexts: [
          {
            userId: 126,
            displayName: "Хачик (@loudsplash)",
            participantMemoryContext: null
          }
        ]
      })
    );
  });

  test("passes trigger text into social analysis and structured reply context into prompt generation", async () => {
    const db = new FakeDatabaseClient();

    db.saveIncomingMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 10,
      text: "ну чо",
      createdAt: "2026-04-10T12:00:00.000Z",
      fromUserId: 42,
      fromUsername: "tom",
      fromFirstName: "Tom",
      fromLastName: null,
      fromDisplayName: "Tom",
      isBot: false,
      entities: [],
      replyToUserId: null,
      replyToMessageId: null
    });
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

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("держи"));
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply,
        summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
      },
      replyDispatcher: vi.fn().mockResolvedValue({
        messageId: 1006,
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
        replyContext: expect.objectContaining({
          triggerMessage: expect.objectContaining({ messageId: 12 }),
          anchorBotMessage: expect.objectContaining({ messageId: 11 }),
          anchorParentMessage: expect.objectContaining({ messageId: 10 })
        }),
        socialIntentReason: null
      })
    );
  });

  test("analyzes random-gated group messages before generating intervention replies", async () => {
    const db = new FakeDatabaseClient();
    const analyzeIntervention = vi.fn().mockResolvedValue(
      createInterventionAnalysisResult({
        shouldIntervene: true,
        situationKind: "debate",
        goal: "provoke",
        intensity: "medium",
        reason: "participants are actively arguing but still engaged",
        confidence: 0.77
      })
    );
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("ну вы и устроили"));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1007,
      createdAt: "2026-04-03T12:11:00.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        analyzeIntervention,
        generateReply,
        summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
      },
      replyDispatcher,
      env: {
        ...createEnv(),
        interjectProbability: 1
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 20,
        text: "а вот тут ты не прав",
        createdAt: "2026-04-03T12:10:00.000Z"
      })
    );

    expect(analyzeIntervention).toHaveBeenCalledWith(
      expect.objectContaining({
        chatTitle: "Friends",
        messages: expect.arrayContaining([
          expect.objectContaining({ messageId: 20 })
        ]),
        now: "2026-04-03T12:10:00.000Z"
      })
    );
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining("structured_intervention:provoke")
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToMessageId: 20,
        text: "ну вы и устроили"
      })
    );
  });

  test("does not generate an intervention reply when analysis says to stay quiet", async () => {
    const db = new FakeDatabaseClient();
    const analyzeIntervention = vi.fn().mockResolvedValue(
      createInterventionAnalysisResult({
        shouldIntervene: false,
        situationKind: "active",
        goal: null,
        intensity: "low",
        reason: "conversation is already moving without the bot",
        confidence: 0.82
      })
    );
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("не должно быть"));
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        analyzeIntervention,
        generateReply,
        summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
      },
      replyDispatcher,
      env: {
        ...createEnv(),
        interjectProbability: 1
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 21,
        text: "просто болтаем"
      })
    );

    expect(analyzeIntervention).toHaveBeenCalledTimes(1);
    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });

  test("drops stale intervention decisions when newer messages arrive during analysis", async () => {
    const db = new FakeDatabaseClient();
    const deferredAnalysis = createDeferred<LlmInterventionAnalysisResult>();
    const analyzeIntervention = vi
      .fn()
      .mockImplementationOnce(async () => deferredAnalysis.promise);
    const generateReply = vi.fn().mockResolvedValue(createReplyResult("поздний ответ"));
    const replyDispatcher = vi.fn();
    const randomValues = [0, 1];
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        analyzeIntervention,
        generateReply,
        summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
      },
      replyDispatcher,
      random: () => randomValues.shift() ?? 1,
      env: {
        ...createEnv(),
        interjectProbability: 1
      }
    });

    const firstRun = orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 22,
        text: "ну все началось",
        createdAt: "2026-04-03T12:12:00.000Z"
      })
    );

    await flushMicrotasks();

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 23,
        text: "уже другая сцена",
        createdAt: "2026-04-03T12:12:05.000Z"
      })
    );

    deferredAnalysis.resolve(
      createInterventionAnalysisResult({
        shouldIntervene: true,
        situationKind: "debate",
        goal: "joke",
        intensity: "medium",
        reason: "old context looked joke-worthy",
        confidence: 0.7
      })
    );

    await firstRun;

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).not.toHaveBeenCalled();
  });
});

function createOrchestrator(input: {
  db: FakeDatabaseClient;
  qwen: Pick<LlmClient, "generateReply" | "summarizeConversation"> &
    Partial<Pick<LlmClient, "analyzeIntervention">>;
  replyDispatcher: ReturnType<typeof vi.fn>;
  env?: AppEnv;
  loadPersona?: (filePath: string, chatId?: number) => Promise<string>;
  now?: () => string;
  random?: () => number;
}): ChatOrchestrator {
  return new ChatOrchestrator({
    db: input.db as unknown as DatabaseClient,
    qwen: {
      analyzeIntervention:
        input.qwen.analyzeIntervention ??
        vi.fn().mockResolvedValue(
          createInterventionAnalysisResult({
            shouldIntervene: false,
            situationKind: null,
            goal: null,
            intensity: null,
            reason: "default test stub",
            confidence: 1
          })
        ),
      generateReply: input.qwen.generateReply,
      summarizeConversation: input.qwen.summarizeConversation
    },
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
    random: input.random ?? (() => 0),
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
    llmReplyTemperature: 0.6,
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
  replyToUserId?: number | null;
  replyToMessageId?: number | null;
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
    fromLastName: null,
    fromDisplayName: "Tom",
    isBot: false,
    entities: input.entities ?? [],
    replyToUserId: input.replyToUserId ?? null,
    replyToMessageId: input.replyToMessageId ?? null
  };
}

function createAliasRecord(
  chatId: number,
  userId: number,
  aliasText: string,
  displayName: string
): ParticipantAliasRecord {
  return {
    chatId,
    userId,
    aliasText,
    aliasNormalized: aliasText.toLowerCase(),
    aliasKind: "first_name",
    confidence: 1,
    lastSeenAt: "2026-04-03T12:00:00.000Z",
    displayName
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
      memoryUpdates: []
    },
    model: "summary-model",
    latencyMs: 30,
    attemptCount: 1,
    promptTokensEstimate: 55
  };
}

function createInterventionAnalysisResult(
  result: LlmInterventionAnalysisResult["result"]
): LlmInterventionAnalysisResult {
  return {
    result,
    model: "summary-model",
    latencyMs: 20,
    attemptCount: 1,
    promptTokensEstimate: 64
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
  private readonly aliases = new Map<string, ParticipantAliasRecord[]>();

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
      isBot: message.isBot,
      replyToMessageId: message.replyToMessageId
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
    replyToMessageId?: number | null;
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
      isBot: true,
      replyToMessageId: input.replyToMessageId ?? null
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

  getParticipantAliases(chatId: number, aliasNormalized: string): ParticipantAliasRecord[] {
    return (this.aliases.get(this.getAliasKey(chatId, aliasNormalized)) ?? []).map((alias) => ({
      ...alias
    }));
  }

  getRecentMessages(chatId: number, limit: number): StoredMessage[] {
    const storedMessages = this.messages.get(chatId) ?? [];

    return storedMessages.slice(-limit).map((message) => ({ ...message }));
  }

  getMessageByTelegramMessageId(chatId: number, messageId: number): StoredMessage | null {
    return (
      (this.messages.get(chatId) ?? []).find((message) => message.messageId === messageId) ?? null
    );
  }

  getMessagesBefore(chatId: number, beforeMessageId: number, limit: number): StoredMessage[] {
    return (this.messages.get(chatId) ?? [])
      .filter((message) => message.messageId < beforeMessageId)
      .slice(-limit)
      .map((message) => ({ ...message }));
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
    updatedAt: string
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
  }

  close(): void {}

  seedParticipantAliases(
    chatId: number,
    aliasNormalized: string,
    aliases: ParticipantAliasRecord[]
  ): void {
    this.aliases.set(
      this.getAliasKey(chatId, aliasNormalized),
      aliases.map((alias) => ({ ...alias }))
    );
  }

  seedParticipantProfile(
    chatId: number,
    userId: number,
    profile: ParticipantProfile
  ): void {
    this.profiles.set(this.getProfileKey(chatId, userId), { ...profile });
  }

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

  private getAliasKey(chatId: number, aliasNormalized: string): string {
    return `${chatId}:${aliasNormalized}`;
  }

  private applyMemoryUpdate(
    chatId: number,
    userId: number,
    update: SummaryResult["memoryUpdates"][number],
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
