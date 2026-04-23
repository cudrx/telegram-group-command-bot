import type { LookupContext, LookupSource } from '../../lookup/types.js';
import { loadPrompt } from '../prompt-files.js';
import { sanitizePromptText } from './sanitize.js';

export function formatLookupContext(context: LookupContext): string {
  return [
    loadPrompt('lookupContext'),
    `status=${sanitizePromptText(context.status)}`,
    `provider=${context.provider ? sanitizePromptText(context.provider) : 'null'}`,
    `purpose=${sanitizePromptText(context.decision.purpose)}`,
    `confidence=${sanitizePromptText(context.decision.confidence)}`,
    `reason="${sanitizePromptText(context.decision.reason)}"`,
    `query=${context.query ? `"${sanitizePromptText(context.query)}"` : 'null'}`,
    `responseTimeMs=${context.responseTimeMs ?? 'null'}`,
    `usageCredits=${context.usageCredits ?? 'null'}`,
    `error=${context.errorMessage ? `"${sanitizePromptText(context.errorMessage)}"` : 'null'}`,
    'BEGIN LOOKUP SOURCES',
    ...context.sources.map((source, index) =>
      formatLookupSource(source, index)
    ),
    'END LOOKUP SOURCES'
  ].join('\n');
}

function formatLookupSource(source: LookupSource, index: number): string {
  return [
    `source#${index + 1}`,
    `title="${sanitizePromptText(source.title)}"`,
    `url="${sanitizePromptText(source.url)}"`,
    `score=${source.score ?? 'null'}`,
    `content="${sanitizePromptText(source.content)}"`
  ].join(' ');
}
