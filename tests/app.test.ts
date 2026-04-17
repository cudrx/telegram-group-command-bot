import { beforeEach, describe, expect, test, vi } from "vitest";

import type { AppEnv } from "../src/config/env.js";

const handleIncomingMessage = vi.fn();
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
const loggerChild = vi.fn();
const createLogger = vi.fn();
const dbClose = vi.fn();
const dbOpen = vi.fn();
const llmConstructor = vi.fn();
const loadAssistantInstructions = vi.fn();
const botGetMe = vi.fn();
const botStart = vi.fn();
const botStop = vi.fn();
const botOn = vi.fn();
const botCatch = vi.fn();
const botUse = vi.fn();
const botSendMessage = vi.fn();
const botSendChatAction = vi.fn();
const chatOrchestratorConstructor = vi.fn();

const botState: {
  middleware: ((ctx: { update: Record<string, unknown> }, next: () => Promise<void>) => Promise<void>) | undefined;
  messageHandler: ((ctx: unknown) => Promise<void>) | undefined;
} = {
  middleware: undefined,
  messageHandler: undefined
};

vi.mock("grammy", () => {
  class Bot {
    public readonly api = {
      getMe: botGetMe,
      sendMessage: botSendMessage,
      sendChatAction: botSendChatAction
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

vi.mock("../src/llm/openai-compatible-llm-client.js", () => ({
  OpenAiCompatibleLlmClient: vi.fn().mockImplementation((...args: unknown[]) => {
    llmConstructor(...args);
    return {};
  })
}));

vi.mock("../src/config/assistant-instructions.js", () => ({
  loadAssistantInstructions
}));

vi.mock("../src/logging/logger.js", () => ({
  createLogger,
  serializeError: (error: unknown) => ({
    errorMessage: error instanceof Error ? error.message : String(error)
  })
}));

vi.mock("../src/app/chat-orchestrator.js", () => ({
  ChatOrchestrator: vi.fn().mockImplementation((...args: unknown[]) => {
    chatOrchestratorConstructor(...args);

    return {
      handleIncomingMessage
    };
  })
}));

describe("createApplication", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    botState.messageHandler = undefined;
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
      first_name: "Assistant"
    });
  });

  test("wires v0 reply-only dependencies and forwards text messages", async () => {
    const { createApplication } = await import("../src/app.js");
    const app = await createApplication(createEnv());

    expect(llmConstructor).toHaveBeenCalledWith({
      apiKey: "llm-key",
      baseUrl: "https://example.com",
      replyModel: "reply-model",
      replyTemperature: 0.6,
      timeoutMs: 20_000,
      maxRetries: 1
    }, undefined, expect.any(Object));

    const orchestratorDeps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          sendTyping?: (chatId: number) => Promise<void>;
        }
      | undefined;

    await orchestratorDeps?.sendTyping?.(-1001);
    expect(botSendChatAction).toHaveBeenCalledWith(-1001, "typing");

    await app.start();

    expect(botStart).toHaveBeenCalledWith({
      allowed_updates: ["message"]
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

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -1001,
        messageId: 11,
        text: "@hrupa_bot привет"
      })
    );
  });

  test("stops bot and closes database without summary timers", async () => {
    const { createApplication } = await import("../src/app.js");
    const app = await createApplication(createEnv());

    await app.stop();

    expect(botStop).toHaveBeenCalled();
    expect(dbClose).toHaveBeenCalled();
  });
});

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
    assistantInstructionsFile: "config/assistant-instructions.md",
    messageContextLimit: 8,
    replyMinTypingMs: 0,
    replyMaxTypingMs: 0,
    replyTypingRefreshMs: 4000
  };
}
