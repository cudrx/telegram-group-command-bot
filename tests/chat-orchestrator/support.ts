import { vi } from 'vitest';

import { ChatOrchestrator } from '../../src/app/chat-orchestrator/index.js';
import type { AppEnv } from '../../src/config/env.js';
import type {
  ChatState,
  NormalizedMessage,
  StoredMessage
} from '../../src/domain/models.js';
import type { AppLogger } from '../../src/logging/logger.js';
import type { LookupProvider } from '../../src/lookup/types.js';
import type {
  SaveMediaArtifactInput,
  StoredMediaArtifact
} from '../../src/storage/database.js';

export function createOrchestrator(input: {
  db: FakeDatabaseClient;
  qwen: {
    generateReply: (input: {
      assistantInstructions: string;
      targetDisplayName: string;
      intent: 'explain' | 'summarize' | 'decide' | 'read' | 'answer';
      replyContext: unknown;
      lookupContext?: unknown;
      mediaContext?: unknown;
    }) => Promise<ReturnType<typeof createReplyResult>>;
    planLookup?: (input: {
      intent: 'explain' | 'decide' | 'answer';
      replyContext: unknown;
    }) => Promise<ReturnType<typeof createLookupPlanResult>>;
  };
  replyDispatcher: (input: {
    chatId: number;
    replyToMessageId: number;
    text: string;
  }) => Promise<{ messageId: number; createdAt: string }>;
  lookupProvider?: LookupProvider | null;
  speechToTextProvider?: {
    transcribe: (input: {
      filePath: string;
      filename: string;
      mimeType: string;
      timeoutMs: number;
    }) => Promise<unknown>;
  } | null;
  ocrProvider?: {
    extractText: (input: {
      filePath: string;
      language: 'rus' | null;
      timeoutMs: number;
    }) => Promise<unknown>;
  } | null;
  visionProvider?: {
    describe: (input: {
      filePath: string;
      timeoutMs: number;
    }) => Promise<unknown>;
  } | null;
  telegramFileApi?: {
    getFile: (fileId: string) => Promise<{ file_path?: string | null }>;
  } | null;
  fetch?: typeof fetch | undefined;
  env?: Partial<AppEnv>;
  logger?: AppLogger;
}): ChatOrchestrator {
  return new ChatOrchestrator({
    db: input.db as never,
    qwen: {
      ...input.qwen,
      planLookup:
        input.qwen.planLookup ??
        vi.fn().mockResolvedValue(
          createLookupPlanResult({
            shouldLookup: false,
            purpose: 'none',
            reason: 'No lookup needed.',
            queries: [],
            confidence: 'low'
          })
        )
    },
    lookupProvider: input.lookupProvider ?? null,
    speechToTextProvider: input.speechToTextProvider as never,
    ocrProvider: input.ocrProvider as never,
    visionProvider: input.visionProvider as never,
    telegramFileApi: input.telegramFileApi ?? null,
    fetch: input.fetch,
    env: createEnv(input.env),
    bot: {
      userId: 77,
      username: 'fun_bot',
      displayName: 'Fun Bot'
    },
    replyDispatcher: input.replyDispatcher,
    sendTyping: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
    logger: input.logger ?? createLogger(),
    random: () => 0,
    now: () => '2026-04-13T09:00:10.000Z'
  });
}

export function createEnv(overrides: Partial<AppEnv> = {}): AppEnv {
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

export function createIncomingMessage(
  overrides: Partial<NormalizedMessage> = {}
): NormalizedMessage {
  return {
    chatId: 1,
    chatType: 'group',
    chatTitle: 'Friends',
    messageId: 1,
    text: 'обычное сообщение',
    createdAt: '2026-04-03T12:00:00.000Z',
    fromUserId: 42,
    fromUsername: 'tom',
    fromFirstName: 'Tom',
    fromLastName: null,
    fromDisplayName: 'Tom',
    isBot: false,
    entities: [],
    replyToUserId: null,
    replyToMessageId: null,
    replyToMessageSnapshot: null,
    replyToMediaSnapshot: null,
    mediaSnapshot: null,
    ...overrides
  };
}

export function createReplyResult(text: string) {
  return {
    text,
    model: 'reply-model',
    latencyMs: 10,
    attemptCount: 1,
    promptTokensEstimate: 20
  };
}

export function createLookupPlanResult(decision: {
  shouldLookup: boolean;
  purpose:
    | 'none'
    | 'entity_grounding'
    | 'fact_check'
    | 'freshness'
    | 'link_extraction';
  reason: string;
  queries: string[];
  confidence: 'high' | 'medium' | 'low';
}) {
  return {
    status: 'ok' as const,
    decision,
    model: 'planner-model',
    latencyMs: 5,
    attemptCount: 1,
    promptTokensEstimate: 30
  };
}

export function createLogger(): AppLogger {
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

function toStoredMediaArtifact(
  input: SaveMediaArtifactInput
): StoredMediaArtifact {
  return {
    id: 1,
    ...input
  };
}

function findLastMediaArtifact(
  artifacts: SaveMediaArtifactInput[],
  predicate: (artifact: SaveMediaArtifactInput) => boolean
): SaveMediaArtifactInput | null {
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = artifacts[index];

    if (artifact && predicate(artifact)) {
      return artifact;
    }
  }

  return null;
}

export class FakeDatabaseClient {
  private readonly messages = new Map<number, StoredMessage[]>();
  private readonly chats = new Map<number, ChatState>();
  readonly savedMediaArtifacts: SaveMediaArtifactInput[] = [];

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
      replyToMessageId: message.replyToMessageId,
      mediaSnapshot: message.mediaSnapshot
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
      chatType: input.chatType as NormalizedMessage['chatType'],
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
      replyToMessageId: input.replyToMessageId ?? null,
      mediaSnapshot: null
    });
  }

  getChatState(chatId: number): ChatState | null {
    const chat = this.chats.get(chatId);

    return chat ? { ...chat } : null;
  }

  getMessagesBefore(
    chatId: number,
    beforeMessageId: number,
    limit: number
  ): StoredMessage[] {
    return (this.messages.get(chatId) ?? [])
      .filter((message) => message.messageId < beforeMessageId)
      .slice(-limit)
      .map((message) => ({ ...message }));
  }

  getMessageByTelegramMessageId(
    chatId: number,
    messageId: number
  ): StoredMessage | null {
    const message = (this.messages.get(chatId) ?? []).find(
      (candidate) => candidate.messageId === messageId
    );

    return message ? { ...message } : null;
  }

  saveMediaArtifact(input: SaveMediaArtifactInput): void {
    this.savedMediaArtifacts.push(input);
  }

  getSuccessfulMediaArtifact(input: {
    fileUniqueId: string | null;
    chatId: number;
    telegramMessageId: number;
    provider: string;
    artifactKind: string;
  }): StoredMediaArtifact | null {
    const byFileUniqueId = input.fileUniqueId
      ? findLastMediaArtifact(this.savedMediaArtifacts, (artifact) => {
          return (
            artifact.fileUniqueId === input.fileUniqueId &&
            artifact.provider === input.provider &&
            artifact.artifactKind === input.artifactKind &&
            artifact.artifactStatus === 'success'
          );
        })
      : null;
    const artifact =
      byFileUniqueId ??
      findLastMediaArtifact(this.savedMediaArtifacts, (candidate) => {
        return (
          candidate.chatId === input.chatId &&
          candidate.telegramMessageId === input.telegramMessageId &&
          candidate.provider === input.provider &&
          candidate.artifactKind === input.artifactKind &&
          candidate.artifactStatus === 'success'
        );
      });

    return artifact ? toStoredMediaArtifact(artifact) : null;
  }

  getLatestMediaArtifact(input: {
    fileUniqueId: string | null;
    chatId: number;
    telegramMessageId: number;
    provider: string;
    artifactKind: string;
  }): StoredMediaArtifact | null {
    const byFileUniqueId = input.fileUniqueId
      ? findLastMediaArtifact(this.savedMediaArtifacts, (artifact) => {
          return (
            artifact.fileUniqueId === input.fileUniqueId &&
            artifact.provider === input.provider &&
            artifact.artifactKind === input.artifactKind
          );
        })
      : null;
    const artifact =
      byFileUniqueId ??
      findLastMediaArtifact(this.savedMediaArtifacts, (candidate) => {
        return (
          candidate.chatId === input.chatId &&
          candidate.telegramMessageId === input.telegramMessageId &&
          candidate.provider === input.provider &&
          candidate.artifactKind === input.artifactKind
        );
      });

    return artifact ? toStoredMediaArtifact(artifact) : null;
  }

  getSuccessfulMediaArtifactsForMessages(input: {
    chatId: number;
    messageIds: number[];
  }): StoredMediaArtifact[] {
    return this.savedMediaArtifacts
      .filter((artifact) => {
        return (
          artifact.chatId === input.chatId &&
          input.messageIds.includes(artifact.telegramMessageId) &&
          artifact.artifactStatus === 'success'
        );
      })
      .map((artifact) => toStoredMediaArtifact(artifact));
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
    chatType: NormalizedMessage['chatType'];
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
