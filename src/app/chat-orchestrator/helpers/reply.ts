import type { AppEnv } from '../../../config/env/index.js';
import type {
  ReplyContext,
  ReplyGenerationIntent,
  StoredMessage
} from '../../../domain/models.js';
import type { LlmReplyResult } from '../../../llm/openai-compatible-client/index.js';

export function withReplySnapshotFallback(
  context: ReplyContext,
  input: {
    intent: ReplyGenerationIntent;
    botUserId: number;
    replyToMessageSnapshot: StoredMessage | null;
  }
): ReplyContext {
  if (
    !usesReplySnapshotFallback(input.intent) ||
    context.replyAnchorMessage ||
    !input.replyToMessageSnapshot ||
    (input.replyToMessageSnapshot.userId === input.botUserId &&
      input.intent !== 'translate')
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
    case 'translate':
      return 0;
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

function usesReplySnapshotFallback(intent: ReplyGenerationIntent): boolean {
  return intent === 'answer' || intent === 'translate';
}
