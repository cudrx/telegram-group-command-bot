import { afterEach, beforeEach, vi } from 'vitest';

import type { AppEnv } from '../../src/config/env/index.js';

export const handleIncomingMessage = vi.fn();
export const loggerInfo = vi.fn();
export const loggerWarn = vi.fn();
export const loggerError = vi.fn();
export const loggerDebug = vi.fn();
export const loggerChild = vi.fn();
export const createLogger = vi.fn();
export const dbClose = vi.fn();
export const dbOpen = vi.fn();
export const dbUpdateIncomingMessageEdit = vi.fn();
export const llmConstructor = vi.fn();
export const botGetMe = vi.fn();
export const botGetFile = vi.fn();
export const botStart = vi.fn();
export const botStop = vi.fn();
export const botOn = vi.fn();
export const botCatch = vi.fn();
export const botUse = vi.fn();
export const botSendMessage = vi.fn();
export const botSendVoice = vi.fn();
export const botSendPhoto = vi.fn();
export const botSendAnimation = vi.fn();
export const botSendChatAction = vi.fn();
export const chatOrchestratorConstructor = vi.fn();
export const tavilyConstructor = vi.fn();
export const gladiaConstructor = vi.fn();
export const cloudflareVisionConstructor = vi.fn();
export const ocrSpaceConstructor = vi.fn();
export const yandexSpeechKitConstructor = vi.fn();
export const maybeAnnounceDeployUpdate = vi.fn();
export const dbCleanupExpiredData = vi.fn();

export const botState: {
  middleware:
    | ((
        ctx: { update: Record<string, unknown> },
        next: () => Promise<void>
      ) => Promise<void>)
    | undefined;
  messageHandler: ((ctx: unknown) => Promise<void>) | undefined;
  editedMessageHandler: ((ctx: unknown) => Promise<void>) | undefined;
} = {
  middleware: undefined,
  messageHandler: undefined,
  editedMessageHandler: undefined
};

vi.mock('grammy', () => {
  class Bot {
    public readonly api = {
      getMe: botGetMe,
      getFile: botGetFile,
      sendMessage: botSendMessage,
      sendVoice: botSendVoice,
      sendPhoto: botSendPhoto,
      sendAnimation: botSendAnimation,
      sendChatAction: botSendChatAction
    };

    constructor(public readonly token: string) {}

    use(
      middleware: (
        ctx: { update: Record<string, unknown> },
        next: () => Promise<void>
      ) => Promise<void>
    ): void {
      botUse(middleware);
      botState.middleware = middleware;
    }

    on(event: string, handler: (ctx: unknown) => Promise<void>): void {
      botOn(event, handler);
      if (event === 'message') {
        botState.messageHandler = handler;
      }
      if (event === 'edited_message') {
        botState.editedMessageHandler = handler;
      }
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

  class InputFile {
    constructor(
      public readonly source: unknown,
      public readonly filename?: string
    ) {}
  }

  return { Bot, InputFile };
});

vi.mock('../../src/database/index.js', () => ({
  DatabaseClient: {
    open: dbOpen
  }
}));

vi.mock('../../src/llm/openai-compatible-client/index.js', () => ({
  OpenAiCompatibleLlmClient: vi
    .fn()
    .mockImplementation((...args: unknown[]) => {
      llmConstructor(...args);
      return {};
    })
}));

vi.mock('../../src/logging/logger.js', () => ({
  createLogger,
  serializeError: (error: unknown) => ({
    errorMessage: error instanceof Error ? error.message : String(error)
  })
}));

vi.mock('../../src/app/chat-orchestrator/index.js', () => ({
  ChatOrchestrator: vi.fn().mockImplementation((...args: unknown[]) => {
    chatOrchestratorConstructor(...args);

    return {
      handleIncomingMessage
    };
  })
}));

vi.mock('../../src/app/deploy-announcer.js', () => ({
  maybeAnnounceDeployUpdate
}));

vi.mock('../../src/lookup/tavily-lookup-provider.js', () => ({
  TavilyLookupProvider: vi.fn().mockImplementation((...args: unknown[]) => {
    tavilyConstructor(...args);
    return { search: vi.fn() };
  })
}));

vi.mock('../../src/media/gladia-transcription-provider.js', () => ({
  GladiaTranscriptionProvider: vi
    .fn()
    .mockImplementation((...args: unknown[]) => {
      gladiaConstructor(...args);
      return { transcribe: vi.fn() };
    })
}));

vi.mock('../../src/media/cloudflare-vision-provider.js', () => ({
  CloudflareVisionProvider: vi.fn().mockImplementation((...args: unknown[]) => {
    cloudflareVisionConstructor(...args);
    return { describe: vi.fn() };
  })
}));

vi.mock('../../src/media/ocr-space-provider.js', () => ({
  OcrSpaceProvider: vi.fn().mockImplementation((...args: unknown[]) => {
    ocrSpaceConstructor(...args);
    return { extractText: vi.fn() };
  })
}));

vi.mock('../../src/tts/yandex-speechkit-provider.js', () => ({
  YandexSpeechKitTtsProvider: vi
    .fn()
    .mockImplementation((...args: unknown[]) => {
      yandexSpeechKitConstructor(...args);
      return { synthesize: vi.fn() };
    })
}));

export function installAppTestHooks(): void {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    botState.messageHandler = undefined;
    botState.editedMessageHandler = undefined;
    botState.middleware = undefined;

    loggerChild.mockReturnValue({
      debug: loggerDebug,
      info: loggerInfo,
      warn: loggerWarn,
      error: loggerError,
      child: loggerChild
    });
    createLogger.mockReturnValue({
      debug: loggerDebug,
      info: loggerInfo,
      warn: loggerWarn,
      error: loggerError,
      child: loggerChild
    });
    dbOpen.mockReturnValue({
      close: dbClose,
      cleanupExpiredData: dbCleanupExpiredData,
      updateIncomingMessageEdit: dbUpdateIncomingMessageEdit
    });
    dbCleanupExpiredData.mockReturnValue({
      mediaArtifacts: 0,
      messages: 0,
      chats: 0,
      memePosts: 0,
      newsPosts: 0
    });
    botGetMe.mockResolvedValue({
      id: 77,
      username: 'hrupa_bot',
      first_name: 'Assistant'
    });
    maybeAnnounceDeployUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}

export async function importCreateApplication() {
  return import('../../src/app.js');
}

export function createEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    nodeEnv: 'test',
    telegramBotToken: 'telegram-token',
    llmApiKey: 'llm-key',
    llmBaseUrl: 'https://example.com',
    llmReplyModel: 'reply-model',
    llmReplyTemperature: 0.6,
    llmTimeoutMs: 20_000,
    llmMaxRetries: 1,
    logLlmText: false,
    logLevel: 'info',
    logColor: true,
    sqlitePath: ':memory:',
    answerContextLimit: 50,
    summarizeContextLimit: 200,
    decideContextLimit: 100,
    replyMinTypingMs: 0,
    replyMaxTypingMs: 0,
    replyTypingRefreshMs: 4000,
    llmPlannerModel: 'planner-model',
    lookupProvider: 'tavily',
    tavilyApiKey: null,
    lookupTimeoutMs: 7000,
    lookupMaxQueries: 1,
    lookupMaxResults: 3,
    ocrSpaceApiKey: null,
    sttProvider: 'gladia',
    gladiaApiKey: null,
    yandexSpeechKitApiKey: null,
    visionProvider: 'cloudflare',
    cloudflareAiApiKey: null,
    cloudflareAccountId: null,
    mediaMaxFileBytes: 10_000_000,
    mediaArtifactRetentionDays: 7,
    memeHistoryRetentionDays: 14,
    messageRetentionDays: 7,
    databaseCleanupIntervalHours: 24,
    telegramChatId: -1002155313986,
    telegramAdminId: 84626969,
    ...overrides
  };
}
