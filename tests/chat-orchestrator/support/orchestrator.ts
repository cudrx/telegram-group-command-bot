import { vi } from 'vitest';

import { ChatOrchestrator } from '../../../src/app/chat-orchestrator/index.js';
import type { TelegramChatAction } from '../../../src/app/typing-indicator.js';
import type { AppEnv } from '../../../src/config/env/index.js';
import type { AssistantIntent, ChatState } from '../../../src/domain/models.js';
import type { AppLogger } from '../../../src/logging/logger.js';
import type {
  LookupIntent,
  LookupProvider
} from '../../../src/lookup/types.js';
import { createEnv } from './env.js';
import type { FakeDatabaseClient } from './fake-database.js';
import { createLookupPlanResult, createReplyResult } from './llm.js';
import { createLogger } from './logger.js';

export function createOrchestrator(input: {
  db: FakeDatabaseClient;
  qwen: {
    generateReply: (input: {
      assistantInstructions: string;
      targetDisplayName: string;
      intent: AssistantIntent;
      currentDateTime: string;
      replyContext: unknown;
      lookupContext?: unknown;
      mediaContext?: unknown;
    }) => Promise<ReturnType<typeof createReplyResult>>;
    generateWeekly?: (input: {
      assistantInstructions: string;
      weeklyDataset: string;
    }) => Promise<ReturnType<typeof createReplyResult>>;
    generateMemeCaption?: (input: {
      title: string;
      subreddit: string;
      upvotes: number;
      permalink: string;
      mediaKind: 'image' | 'gallery' | 'video' | 'animation';
    }) => Promise<ReturnType<typeof createReplyResult>>;
    planLookup?: (input: {
      intent: LookupIntent;
      replyContext: unknown;
    }) => Promise<ReturnType<typeof createLookupPlanResult>>;
  };
  replyDispatcher: (input: {
    chatId: number;
    replyToMessageId: number;
    text: string;
  }) => Promise<{ messageId: number; createdAt: string }>;
  weeklyDispatcher?: (input: {
    chatId: number;
    text: string;
  }) => Promise<{ messageId: number; createdAt: string }>;
  memeDispatcher?: (input: {
    chatId: number;
    replyToMessageId: number;
    caption: string;
    media:
      | { kind: 'image'; filePath: string }
      | { kind: 'video'; filePath: string }
      | { kind: 'animation'; filePath: string }
      | { kind: 'gallery'; files: Array<{ filePath: string }> };
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
  textToSpeechProvider?: {
    synthesize: (input: {
      text: string;
      timeoutMs: number;
    }) => Promise<unknown>;
  } | null;
  voiceDispatcher?: (input: {
    chatId: number;
    replyToMessageId: number;
    audioBytes: Uint8Array;
    filename: string;
    mimeType: 'audio/ogg';
  }) => Promise<{ messageId: number; createdAt: string }>;
  sendTyping?: (chatId: number) => Promise<void>;
  sendChatAction?: (
    chatId: number,
    action: TelegramChatAction
  ) => Promise<void>;
  random?: () => number;
  now?: () => string;
  initialChatTtsState?: Partial<
    Pick<
      ChatState,
      | 'answerLastOutputMode'
      | 'answerEligibleTextSinceVoice'
      | 'answerEligibleTextStreak'
      | 'readLastVoiceAt'
      | 'readTtsVoiceCount'
    >
  >;
}): ChatOrchestrator {
  const sendChatAction =
    input.sendChatAction ??
    (input.sendTyping
      ? (chatId: number) => input.sendTyping?.(chatId) ?? Promise.resolve()
      : vi.fn().mockResolvedValue(undefined));

  if (input.initialChatTtsState) {
    input.db.updateChatTtsState({
      chatId: 1,
      ...input.initialChatTtsState
    });
  }

  return new ChatOrchestrator({
    db: input.db as never,
    qwen: {
      ...input.qwen,
      generateWeekly:
        input.qwen.generateWeekly ??
        vi.fn().mockResolvedValue(createReplyResult('<b>Неделя в чате</b>')),
      generateMemeCaption:
        input.qwen.generateMemeCaption ??
        vi.fn().mockResolvedValue(createReplyResult('мем')),
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
    textToSpeechProvider: input.textToSpeechProvider as never,
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
    voiceDispatcher:
      input.voiceDispatcher ??
      vi.fn().mockResolvedValue({
        messageId: 2000,
        createdAt: '2026-04-13T09:00:30.000Z'
      }),
    weeklyDispatcher:
      input.weeklyDispatcher ??
      vi.fn().mockResolvedValue({
        messageId: 1000,
        createdAt: '2026-04-13T09:00:30.000Z'
      }),
    memeDispatcher:
      input.memeDispatcher ??
      vi.fn().mockResolvedValue({
        messageId: 3000,
        createdAt: '2026-04-13T09:00:30.000Z'
      }),
    sendChatAction,
    delay: vi.fn().mockResolvedValue(undefined),
    logger: input.logger ?? createLogger(),
    random: input.random ?? (() => 0),
    now: input.now ?? (() => '2026-04-13T09:00:10.000Z')
  });
}
