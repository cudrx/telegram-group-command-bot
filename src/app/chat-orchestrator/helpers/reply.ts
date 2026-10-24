import type { AppEnv } from '../../../config/env/index.js';
import type { ReplyGenerationIntent } from '../../../domain/models.js';
import type { LlmReplyResult } from '../../../llm/openai-compatible-client/index.js';

export function getContextLimitForIntent(
  env: AppEnv,
  intent: ReplyGenerationIntent
): number {
  switch (intent) {
    case 'read':
      return 0;
    case 'answer':
      return env.answerContextLimit;
    case 'translate':
      return 5;
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
