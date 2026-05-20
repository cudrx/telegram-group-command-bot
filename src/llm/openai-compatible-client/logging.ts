import type { ReplyGenerationIntent } from '../../domain/models.js';
import { getIntentOutputShapeViolations } from '../intent-output-shape.js';
import type { LlmClientOptions } from './types.js';

type LogPayload = {
  kind: 'reply' | 'lookup_planner' | 'deploy_update' | 'news';
  model: string;
  temperature?: number;
  latencyMs?: number;
  attemptCount?: number;
  promptTokensEstimate?: number;
  promptChars?: number;
  responseChars?: number;
  responsePreview?: string;
};

export function estimateTokens(prompt: string): number {
  return Math.max(1, Math.ceil(prompt.length / 4));
}

export function toSingleLinePreview(text: string, maxLength = 240): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();

  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, maxLength - 3)}...`;
}

export function logLlmText(
  options: LlmClientOptions,
  event: string,
  payload: LogPayload
): void {
  if (!options.logLlmText) {
    return;
  }

  options.logger?.info(event, payload);
}

export function warnOnReplyFormatGuardrailViolation(
  options: LlmClientOptions,
  intent: ReplyGenerationIntent,
  reply: string,
  model: string
): void {
  const violations = getIntentOutputShapeViolations(intent, reply);
  const hasEnglishSummaryHeading = violations.includes(
    'english_summary_heading'
  );
  const hasMarkdownBold = violations.includes('markdown_bold');

  if (violations.length === 0) {
    return;
  }

  options.logger?.warn('llm.reply_format_guardrail_warning', {
    kind: 'reply',
    model,
    intent,
    hasEnglishSummaryHeading,
    hasMarkdownBold,
    violations
  });
}
