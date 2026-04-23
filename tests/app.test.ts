import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { AppEnv } from '../src/config/env.js';

const handleIncomingMessage = vi.fn();
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
const loggerDebug = vi.fn();
const loggerChild = vi.fn();
const createLogger = vi.fn();
const dbClose = vi.fn();
const dbOpen = vi.fn();
const llmConstructor = vi.fn();
const botGetMe = vi.fn();
const botGetFile = vi.fn();
const botStart = vi.fn();
const botStop = vi.fn();
const botOn = vi.fn();
const botCatch = vi.fn();
const botUse = vi.fn();
const botSendMessage = vi.fn();
const botSendChatAction = vi.fn();
const chatOrchestratorConstructor = vi.fn();
const tavilyConstructor = vi.fn();
const gladiaConstructor = vi.fn();
const cloudflareVisionConstructor = vi.fn();
const ocrSpaceConstructor = vi.fn();
const maybeAnnounceDeployUpdate = vi.fn();
const dbCleanupExpiredData = vi.fn();

const botState: {
  middleware:
    | ((
        ctx: { update: Record<string, unknown> },
        next: () => Promise<void>
      ) => Promise<void>)
    | undefined;
  messageHandler: ((ctx: unknown) => Promise<void>) | undefined;
} = {
  middleware: undefined,
  messageHandler: undefined
};

vi.mock('grammy', () => {
  class Bot {
    public readonly api = {
      getMe: botGetMe,
      getFile: botGetFile,
      sendMessage: botSendMessage,
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

vi.mock('../src/database/index.js', () => ({
  DatabaseClient: {
    open: dbOpen
  }
}));

vi.mock('../src/llm/openai-compatible-llm-client.js', () => ({
  OpenAiCompatibleLlmClient: vi
    .fn()
    .mockImplementation((...args: unknown[]) => {
      llmConstructor(...args);
      return {};
    })
}));

vi.mock('../src/logging/logger.js', () => ({
  createLogger,
  serializeError: (error: unknown) => ({
    errorMessage: error instanceof Error ? error.message : String(error)
  })
}));

vi.mock('../src/app/chat-orchestrator/index.js', () => ({
  ChatOrchestrator: vi.fn().mockImplementation((...args: unknown[]) => {
    chatOrchestratorConstructor(...args);

    return {
      handleIncomingMessage
    };
  })
}));

vi.mock('../src/app/deploy-announcer.js', () => ({
  maybeAnnounceDeployUpdate
}));

vi.mock('../src/lookup/tavily-lookup-provider.js', () => ({
  TavilyLookupProvider: vi.fn().mockImplementation((...args: unknown[]) => {
    tavilyConstructor(...args);
    return { search: vi.fn() };
  })
}));

vi.mock('../src/media/gladia-transcription-provider.js', () => ({
  GladiaTranscriptionProvider: vi
    .fn()
    .mockImplementation((...args: unknown[]) => {
      gladiaConstructor(...args);
      return { transcribe: vi.fn() };
    })
}));

vi.mock('../src/media/cloudflare-vision-provider.js', () => ({
  CloudflareVisionProvider: vi.fn().mockImplementation((...args: unknown[]) => {
    cloudflareVisionConstructor(...args);
    return { describe: vi.fn() };
  })
}));

vi.mock('../src/media/ocr-space-provider.js', () => ({
  OcrSpaceProvider: vi.fn().mockImplementation((...args: unknown[]) => {
    ocrSpaceConstructor(...args);
    return { extractText: vi.fn() };
  })
}));

describe('createApplication', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    botState.messageHandler = undefined;
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
      cleanupExpiredData: dbCleanupExpiredData
    });
    dbCleanupExpiredData.mockReturnValue({
      mediaArtifacts: 0,
      messages: 0,
      chats: 0
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

  test('wires v0 reply-only dependencies and forwards text messages', async () => {
    const { createApplication } = await import('../src/app.js');
    const app = await createApplication(createEnv());

    expect(llmConstructor).toHaveBeenCalledWith(
      {
        apiKey: 'llm-key',
        baseUrl: 'https://example.com',
        replyModel: 'reply-model',
        replyTemperature: 0.6,
        replyEnableThinking: false,
        plannerModel: 'planner-model',
        lookupMaxQueries: 1,
        timeoutMs: 20_000,
        maxRetries: 1
      },
      undefined,
      expect.any(Object)
    );

    const orchestratorDeps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          sendTyping?: (chatId: number) => Promise<void>;
        }
      | undefined;

    await orchestratorDeps?.sendTyping?.(-1001);
    expect(botSendChatAction).toHaveBeenCalledWith(-1001, 'typing');

    await app.start();

    expect(botStart).toHaveBeenCalledWith({
      allowed_updates: ['message']
    });

    await botState.messageHandler?.({
      message: {
        message_id: 11,
        date: 1_744_000_000,
        text: '@hrupa_bot привет',
        entities: [{ type: 'mention', offset: 0, length: 10 }],
        from: {
          id: 123,
          is_bot: false,
          username: 'artyom',
          first_name: 'Artyom'
        },
        chat: {
          id: -1001,
          type: 'supergroup',
          title: 'Test chat'
        }
      }
    });

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -1001,
        messageId: 11,
        text: '@hrupa_bot привет'
      })
    );
  });

  test('forwards text messages from other bots so explain replies can use them as anchors', async () => {
    const { createApplication } = await import('../src/app.js');
    await createApplication(createEnv());

    await botState.messageHandler?.({
      message: {
        message_id: 12,
        date: 1_744_000_000,
        text: 'кто сильнее лев или тигр?',
        from: {
          id: 555,
          is_bot: true,
          username: 'rofl_bot',
          first_name: 'Rofl Bot'
        },
        chat: {
          id: -1001,
          type: 'supergroup',
          title: 'Test chat'
        }
      }
    });

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -1001,
        messageId: 12,
        text: 'кто сильнее лев или тигр?',
        isBot: true,
        fromUserId: 555
      })
    );
  });

  test('forwards replied-to text snapshots for explain fallback anchors', async () => {
    const { createApplication } = await import('../src/app.js');
    await createApplication(createEnv());

    await botState.messageHandler?.({
      message: {
        message_id: 13,
        date: 1_744_000_030,
        text: '/explain',
        entities: [{ type: 'bot_command', offset: 0, length: 8 }],
        from: {
          id: 123,
          is_bot: false,
          username: 'artyom',
          first_name: 'Artyom'
        },
        chat: {
          id: -1001,
          type: 'supergroup',
          title: 'Test chat'
        },
        reply_to_message: {
          message_id: 12,
          date: 1_744_000_000,
          text: 'кто сильнее лев или тигр?',
          from: {
            id: 555,
            is_bot: true,
            username: 'rofl_bot',
            first_name: 'Rofl Bot'
          },
          chat: {
            id: -1001,
            type: 'supergroup',
            title: 'Test chat'
          }
        }
      }
    });

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 13,
        replyToMessageId: 12,
        replyToMessageSnapshot: expect.objectContaining({
          messageId: 12,
          userId: 555,
          isBot: true,
          text: 'кто сильнее лев или тигр?'
        })
      })
    );
  });

  test('forwards media captions as message text', async () => {
    const { createApplication } = await import('../src/app.js');
    await createApplication(createEnv());

    await botState.messageHandler?.({
      message: {
        message_id: 14,
        date: 1_744_000_040,
        video: {
          file_id: 'video-file',
          file_unique_id: 'video-unique',
          duration: 14,
          width: 720,
          height: 1280
        },
        caption: 'POV: Трамп объявляет, что он открыл пролив.',
        caption_entities: [{ type: 'bold', offset: 0, length: 3 }],
        from: {
          id: 123,
          is_bot: false,
          username: 'artyom',
          first_name: 'Artyom'
        },
        chat: {
          id: -1001,
          type: 'supergroup',
          title: 'Test chat'
        }
      }
    });

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -1001,
        messageId: 14,
        text: 'POV: Трамп объявляет, что он открыл пролив.',
        entities: [{ type: 'bold', offset: 0, length: 3 }]
      })
    );
  });

  test('forwards replied-to media captions for explain fallback anchors', async () => {
    const { createApplication } = await import('../src/app.js');
    await createApplication(createEnv());

    await botState.messageHandler?.({
      message: {
        message_id: 15,
        date: 1_744_000_050,
        text: '/explain',
        entities: [{ type: 'bot_command', offset: 0, length: 8 }],
        from: {
          id: 123,
          is_bot: false,
          username: 'artyom',
          first_name: 'Artyom'
        },
        chat: {
          id: -1001,
          type: 'supergroup',
          title: 'Test chat'
        },
        reply_to_message: {
          message_id: 14,
          date: 1_744_000_040,
          video: {
            file_id: 'video-file',
            file_unique_id: 'video-unique',
            duration: 14,
            width: 720,
            height: 1280
          },
          caption: 'POV: Трамп объявляет, что он открыл пролив.',
          from: {
            id: 124,
            is_bot: false,
            username: 'artur',
            first_name: 'Artur'
          },
          chat: {
            id: -1001,
            type: 'supergroup',
            title: 'Test chat'
          }
        }
      }
    });

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 15,
        replyToMessageId: 14,
        replyToMessageSnapshot: expect.objectContaining({
          messageId: 14,
          userId: 124,
          isBot: false,
          text: 'POV: Трамп объявляет, что он открыл пролив.'
        })
      })
    );
  });

  test('sends bot replies with Telegram HTML parse mode', async () => {
    const { createApplication } = await import('../src/app.js');
    await createApplication(createEnv());

    botSendMessage.mockResolvedValue({
      message_id: 44,
      date: 1_744_000_000
    });

    const orchestratorDeps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          replyDispatcher?: (input: {
            chatId: number;
            replyToMessageId: number;
            text: string;
          }) => Promise<{ messageId: number; createdAt: string }>;
        }
      | undefined;

    const sent = await orchestratorDeps?.replyDispatcher?.({
      chatId: -1001,
      replyToMessageId: 11,
      text: '<b>Коротко</b>'
    });

    expect(botSendMessage).toHaveBeenCalledWith(-1001, '<b>Коротко</b>', {
      parse_mode: 'HTML',
      reply_parameters: {
        message_id: 11
      }
    });
    expect(sent).toEqual({
      messageId: 44,
      createdAt: '2025-04-07T04:26:40.000Z'
    });
  });

  test('announces deploy updates before polling starts', async () => {
    const { createApplication } = await import('../src/app.js');
    const app = await createApplication(createEnv());

    await app.start();

    expect(maybeAnnounceDeployUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        deployNotifyChatId: -1002155313986,
        db: expect.any(Object),
        llm: expect.any(Object),
        sendMessage: expect.any(Function),
        logger: expect.any(Object),
        now: expect.any(Function)
      })
    );
    expect(botStart).toHaveBeenCalledWith({
      allowed_updates: ['message']
    });
  });

  test('stops bot and closes database without summary timers', async () => {
    const { createApplication } = await import('../src/app.js');
    const app = await createApplication(createEnv());

    await app.stop();

    expect(botStop).toHaveBeenCalled();
    expect(dbClose).toHaveBeenCalled();
  });

  test('wires planner model and Tavily lookup provider when enabled', async () => {
    const { createApplication } = await import('../src/app.js');
    await createApplication(
      createEnv({
        llmPlannerModel: 'planner-model',
        lookupEnabled: true,
        lookupProvider: 'tavily',
        tavilyApiKey: 'tvly-key',
        lookupTimeoutMs: 7000,
        lookupMaxQueries: 1,
        lookupMaxResults: 3
      })
    );

    expect(llmConstructor).toHaveBeenCalledWith(
      {
        apiKey: 'llm-key',
        baseUrl: 'https://example.com',
        replyModel: 'reply-model',
        replyTemperature: 0.6,
        replyEnableThinking: false,
        plannerModel: 'planner-model',
        lookupMaxQueries: 1,
        timeoutMs: 20_000,
        maxRetries: 1
      },
      undefined,
      expect.any(Object)
    );
    expect(tavilyConstructor).toHaveBeenCalledWith({ apiKey: 'tvly-key' });
    expect(chatOrchestratorConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupProvider: expect.objectContaining({
          search: expect.any(Function)
        })
      })
    );
  });

  test('wires media providers when media analysis is enabled', async () => {
    const { createApplication } = await import('../src/app.js');
    await createApplication(
      createEnv({
        mediaAnalysisEnabled: true,
        ocrSpaceApiKey: 'ocr-key',
        gladiaApiKey: 'gladia-key',
        cloudflareAiApiKey: 'cf-key',
        cloudflareAccountId: 'cf-account'
      })
    );

    expect(gladiaConstructor).toHaveBeenCalledWith({ apiKey: 'gladia-key' });
    expect(ocrSpaceConstructor).toHaveBeenCalledWith({ apiKey: 'ocr-key' });
    expect(cloudflareVisionConstructor).toHaveBeenCalledWith({
      accountId: 'cf-account',
      apiKey: 'cf-key'
    });
    expect(chatOrchestratorConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        speechToTextProvider: expect.objectContaining({
          transcribe: expect.any(Function)
        }),
        ocrProvider: expect.objectContaining({
          extractText: expect.any(Function)
        }),
        visionProvider: expect.objectContaining({
          describe: expect.any(Function)
        }),
        telegramFileApi: expect.objectContaining({
          getFile: expect.any(Function)
        }),
        fetch: expect.any(Function)
      })
    );
  });

  test('runs database cleanup on start and clears timer on stop', async () => {
    vi.useFakeTimers();
    const { createApplication } = await import('../src/app.js');
    const app = await createApplication(
      createEnv({
        databaseCleanupIntervalHours: 2,
        messageRetentionDays: 3,
        mediaArtifactRetentionDays: 5
      })
    );

    await app.start();

    expect(dbCleanupExpiredData).toHaveBeenCalledWith({
      now: expect.any(String),
      messageRetentionDays: 3,
      mediaArtifactRetentionDays: 5
    });

    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(dbCleanupExpiredData).toHaveBeenCalledTimes(2);

    await app.stop();
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(dbCleanupExpiredData).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

function createEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    nodeEnv: 'test',
    telegramBotToken: 'telegram-token',
    llmApiKey: 'llm-key',
    llmBaseUrl: 'https://example.com',
    llmReplyModel: 'reply-model',
    llmReplyTemperature: 0.6,
    llmReplyEnableThinking: false,
    llmTimeoutMs: 20_000,
    llmMaxRetries: 1,
    logLlmText: false,
    logLevel: 'info',
    logColor: true,
    sqlitePath: ':memory:',
    explainContextLimit: 50,
    answerContextLimit: 50,
    summarizeContextLimit: 200,
    decideContextLimit: 100,
    replyMinTypingMs: 0,
    replyMaxTypingMs: 0,
    replyTypingRefreshMs: 4000,
    llmPlannerModel: 'planner-model',
    lookupEnabled: false,
    lookupProvider: 'tavily',
    tavilyApiKey: null,
    lookupTimeoutMs: 7000,
    lookupMaxQueries: 1,
    lookupMaxResults: 3,
    mediaAnalysisEnabled: false,
    ocrSpaceApiKey: null,
    readContextLimit: 10,
    sttProvider: 'gladia',
    gladiaApiKey: null,
    visionProvider: 'cloudflare',
    cloudflareAiApiKey: null,
    cloudflareAccountId: null,
    mediaMaxFileBytes: 10_000_000,
    mediaArtifactRetentionDays: 7,
    messageRetentionDays: 7,
    databaseCleanupIntervalHours: 24,
    deployNotifyChatId: -1002155313986,
    ...overrides
  };
}
