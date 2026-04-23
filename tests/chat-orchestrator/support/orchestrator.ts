import { vi } from 'vitest';

import { ChatOrchestrator } from '../../../src/app/chat-orchestrator/index.js';
import type { AppEnv } from '../../../src/config/env/index.js';
import type { AppLogger } from '../../../src/logging/logger.js';
import type { LookupProvider } from '../../../src/lookup/types.js';
import { createEnv } from './env.js';
import type { FakeDatabaseClient } from './fake-database.js';
import { createLookupPlanResult, type createReplyResult } from './llm.js';
import { createLogger } from './logger.js';

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
  sendTyping?: (chatId: number) => Promise<void>;
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
    sendTyping: input.sendTyping ?? vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
    logger: input.logger ?? createLogger(),
    random: () => 0,
    now: () => '2026-04-13T09:00:10.000Z'
  });
}
