import type { AppEnv } from '../../../config/env/index.js';
import type {
  ReplyContext,
  ReplyGenerationIntent,
  StoredMessage
} from '../../../domain/models.js';
import type { LlmReplyResult } from '../../../llm/openai-compatible-client/index.js';
import { withChatActionIndicator } from '../../typing-indicator.js';
import type { ChatOrchestratorDeps } from '../types.js';

export const ANSWER_USAGE_PLACEHOLDER =
  'Сделай reply на сообщение с вопросом и отправь /answer.';

export function withReplySnapshotFallback(
  context: ReplyContext,
  input: {
    intent: ReplyGenerationIntent;
    botUserId: number;
    replyToMessageSnapshot: StoredMessage | null;
  }
): ReplyContext {
  if (
    input.intent !== 'answer' ||
    context.replyAnchorMessage ||
    !input.replyToMessageSnapshot ||
    input.replyToMessageSnapshot.userId === input.botUserId
  ) {
    return context;
  }

  return {
    ...context,
    replyAnchorMessage: input.replyToMessageSnapshot
  };
}

export function getContextLimitForIntent(
  env: AppEnv,
  intent: ReplyGenerationIntent
): number {
  switch (intent) {
    case 'summarize':
      return env.summarizeContextLimit;
    case 'decide':
      return env.decideContextLimit;
    case 'read':
      return 0;
    case 'answer':
      return env.answerContextLimit;
  }
}

export function createLocalReplyResult(text: string): LlmReplyResult {
  return {
    text,
    model: 'local',
    source: 'local',
    latencyMs: 0,
    attemptCount: 0,
    promptTokensEstimate: 0
  };
}

export function runWithReplyTyping<T>(
  deps: Pick<
    ChatOrchestratorDeps,
    'delay' | 'env' | 'random' | 'sendChatAction'
  >,
  chatId: number,
  operation: () => Promise<T>
): Promise<T> {
  return withChatActionIndicator(
    {
      chatId,
      action: 'typing',
      minVisibleMs: deps.env.replyMinTypingMs,
      maxVisibleMs: deps.env.replyMaxTypingMs,
      refreshMs: deps.env.replyTypingRefreshMs,
      random: deps.random,
      delay: deps.delay,
      sendChatAction: deps.sendChatAction
    },
    operation
  );
}

export function runWithReplyVoiceRecording<T>(
  deps: Pick<
    ChatOrchestratorDeps,
    'delay' | 'env' | 'random' | 'sendChatAction'
  >,
  chatId: number,
  operation: () => Promise<T>
): Promise<T> {
  return withChatActionIndicator(
    {
      chatId,
      action: 'record_voice',
      minVisibleMs: deps.env.replyMinTypingMs,
      maxVisibleMs: deps.env.replyMaxTypingMs,
      refreshMs: deps.env.replyTypingRefreshMs,
      random: deps.random,
      delay: deps.delay,
      sendChatAction: deps.sendChatAction
    },
    operation
  );
}
