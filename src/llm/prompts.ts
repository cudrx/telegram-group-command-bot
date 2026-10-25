import type { ReplyContext, ReplyGenerationIntent } from '../domain/models.js';
import { text } from '../locales/locale.js';
import { loadPrompt } from './prompt-files.js';
import { getIntentDataSections } from './prompts/data-sections.js';
import { renderPromptTemplate } from './prompts/render.js';
import { sanitizePromptText } from './prompts/sanitize.js';

export {
  formatConversationForLlm,
  formatReplyContextMetadata
} from './prompts/transcript.js';
export type { DescribeMediaContext, PromptMessage } from './prompts/types.js';

export function buildIntentPrompt(input: {
  assistantInstructions: string;
  targetDisplayName: string;
  intent: Exclude<ReplyGenerationIntent, 'answer'>;
  currentDateTime: string;
  replyContext: ReplyContext;
  mediaContext?: import('./prompts/types.js').DescribeMediaContext | null;
}): string {
  const dataSections = getIntentDataSections(input);
  return renderPromptTemplate(loadPrompt('replyShell'), {
    assistantInstructions: input.assistantInstructions,
    assistantDisplayName: text.assistant.displayName,
    globalPrompt: loadPrompt('global'),
    targetDisplayName: sanitizePromptText(input.targetDisplayName),
    intent: input.intent,
    currentDateTime: sanitizePromptText(input.currentDateTime),
    intentPrompt: renderPromptTemplate(loadPrompt(input.intent), {
      readOriginalLabel: text.llm.sections.read.original,
      readTranslationLabel: text.llm.sections.read.translation
    }),
    dataSections
  });
}
