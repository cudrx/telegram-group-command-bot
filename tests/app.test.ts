import { beforeEach, describe, expect, test, vi } from "vitest";

import type { AppEnv } from "../src/config/env.js";

const handleIncomingMessage = vi.fn();
const runIdleSummarySweep = vi.fn();
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
const loggerChild = vi.fn();
const createLogger = vi.fn();
const dbClose = vi.fn();
const dbOpen = vi.fn();
const qwenConstructor = vi.fn();
const loadPersona = vi.fn();
const botGetMe = vi.fn();
const botStart = vi.fn();
const botStop = vi.fn();
const botOn = vi.fn();
const botCatch = vi.fn();
const botUse = vi.fn();
const botSendMessage = vi.fn();

const botState: {
  middleware: ((ctx: { update: Record<string, unknown> }, next: () => Promise<void>) => Promise<void>) | undefined;
  messageHandler: ((ctx: unknown) => Promise<void>) | undefined;
  errorHandler: ((error: unknown) => Promise<void> | void) | undefined;
} = {
  middleware: undefined,
  messageHandler: undefined,
  errorHandler: undefined
};

vi.mock("grammy", () => {
  class Bot {
    public readonly api = {
      getMe: botGetMe,
      sendMessage: botSendMessage
    };

    constructor(public readonly token: string) {}

    use(
      middleware: (ctx: { update: Record<string, unknown> }, next: () => Promise<void>) => Promise<void>
    ): void {
      botUse(middleware);
      botState.middleware = middleware;
    }

    on(event: string, handler: (ctx: unknown) => Promise<void>): void {
      botOn(event, handler);
      botState.messageHandler = handler;
    }

    catch(handler: (error: unknown) => Promise<void> | void): void {
      botCatch(handler);
      botState.errorHandler = handler;
    }

    async start(options: unknown): Promise<void> {
      botStart(options);
    }

    stop(): void {
      botStop();
    }
  }

  return { Bot };
});

vi.mock("../src/storage/database.js", () => ({
  DatabaseClient: {
    open: dbOpen
  }
}));

vi.mock("../src/llm/qwen-client.js", () => ({
  QwenClient: vi.fn().mockImplementation((...args: unknown[]) => {
    qwenConstructor(...args);
    return {};
  })
}));

vi.mock("../src/config/persona.js", () => ({
  loadPersona
}));

vi.mock("../src/logging/logger.js", () => ({
  createLogger,
  serializeError: (error: unknown) => {
    if (error instanceof Error) {
      return {
        errorName: error.name,
        errorMessage: error.message
      };
    }

    return {
      errorMessage: String(error)
    };
  }
}));

vi.mock("../src/app/chat-orchestrator.js", () => ({
  ChatOrchestrator: vi.fn().mockImplementation(() => ({
    handleIncomingMessage,
    runIdleSummarySweep
  }))
}));

describe("createApplication", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    botState.messageHandler = undefined;
    botState.errorHandler = undefined;
    botState.middleware = undefined;

    loggerChild.mockReturnValue({
      info: loggerInfo,
      warn: loggerWarn,
      error: loggerError,
      child: loggerChild
    });
    createLogger.mockReturnValue({
      info: loggerInfo,
      warn: loggerWarn,
      error: loggerError,
      child: loggerChild
    });
    dbOpen.mockReturnValue({
      close: dbClose
    });
    botGetMe.mockResolvedValue({
      id: 77,
      username: "hrupa_bot",
      first_name: "Хрюпа"
    });
  });

  test("logs startup, raw updates, and mention-bearing incoming messages", async () => {
    const { createApplication } = await import("../src/app.js");
    const app = await createApplication(createEnv());

    expect(qwenConstructor).toHaveBeenCalledWith({
      apiKey: "llm-key",
      baseUrl: "https://example.com",
      replyModel: "reply-model",
      summaryModel: "summary-model",
      timeoutMs: 20_000,
      maxRetries: 1
    });

    await app.start();

    expect(loggerInfo).toHaveBeenCalledWith("bot_initialized", {
      botUserId: 77,
      botUsername: "hrupa_bot"
    });
    expect(loggerInfo).toHaveBeenCalledWith("bot_polling_started", {
      allowedUpdates: ["message"]
    });

    await botState.middleware?.(
      {
        update: {
          update_id: 9001,
          message: {
            message_id: 11,
            text: "@hrupa_bot привет"
          }
        }
      },
      async () => {}
    );

    expect(loggerInfo).toHaveBeenCalledWith("telegram_update_received", {
      updateId: 9001,
      updateKinds: ["message"],
      hasMessageText: true,
      chatId: undefined,
      chatType: undefined,
      messageId: 11,
      messageKeys: ["message_id", "text"]
    });

    await botState.messageHandler?.({
      message: {
        message_id: 11,
        date: 1_744_000_000,
        text: "@hrupa_bot привет",
        entities: [{ type: "mention", offset: 0, length: 10 }],
        from: {
          id: 123,
          is_bot: false,
          username: "artyom",
          first_name: "Artyom"
        },
        chat: {
          id: -1001,
          type: "supergroup",
          title: "Test chat"
        }
      }
    });

    expect(loggerInfo).toHaveBeenCalledWith("incoming_message_received", {
      chatId: -1001,
      messageId: 11,
      chatType: "supergroup",
      fromUserId: 123,
      hasMention: true,
      isReplyToBot: false
    });
    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -1001,
        messageId: 11,
        text: "@hrupa_bot привет"
      })
    );
  });

  test("logs raw message metadata for non-text updates", async () => {
    const { createApplication } = await import("../src/app.js");
    const app = await createApplication(createEnv());

    await app.start();

    await botState.middleware?.(
      {
        update: {
          update_id: 9002,
          message: {
            message_id: 12,
            new_chat_members: [{ id: 77, is_bot: true }],
            chat: {
              id: -1001,
              type: "supergroup"
            }
          }
        }
      },
      async () => {}
    );

    expect(loggerInfo).toHaveBeenCalledWith("telegram_update_received", {
      updateId: 9002,
      updateKinds: ["message"],
      hasMessageText: false,
      chatId: -1001,
      chatType: "supergroup",
      messageId: 12,
      messageKeys: ["chat", "message_id", "new_chat_members"]
    });
  });
});

function createEnv(): AppEnv {
  return {
    nodeEnv: "development",
    telegramBotToken: "telegram-token",
    llmApiKey: "llm-key",
    llmBaseUrl: "https://example.com",
    llmReplyModel: "reply-model",
    llmSummaryModel: "summary-model",
    llmTimeoutMs: 20_000,
    llmMaxRetries: 1,
    sqlitePath: "data/test.sqlite",
    personaFile: "config/persona.md",
    interjectProbability: 0.12,
    interjectCooldownMinutes: 30,
    chatIdleMinutes: 30,
    minMessagesForSummary: 10,
    messageContextLimit: 16,
    summarySweepIntervalMs: 60_000,
    messageRetentionDays: 180
  };
}
