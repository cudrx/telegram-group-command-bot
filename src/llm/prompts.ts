import type { ReplyContext, ReplyGenerationIntent } from '../domain/models.js';
import { text } from '../locales/locale.js';
import type { LookupContext } from '../lookup/types.js';
import { loadPrompt } from './prompt-files.js';
import { getIntentDataSections } from './prompts/data-sections.js';
import { formatLookupContext } from './prompts/lookup.js';
import { renderPromptTemplate } from './prompts/render.js';
import { sanitizePromptText } from './prompts/sanitize.js';

export { formatConversationForLlm } from './prompts/transcript.js';
export type { DescribeMediaContext, PromptMessage } from './prompts/types.js';

export function buildIntentPrompt(input: {
  assistantInstructions: string;
  targetDisplayName: string;
  intent: ReplyGenerationIntent;
  currentDateTime: string;
  replyContext: ReplyContext;
  lookupContext?: LookupContext | null;
  mediaContext?: import('./prompts/types.js').DescribeMediaContext | null;
}): string {
  const dataSections = getIntentDataSections(input);
  const lookupSections =
    input.intent === 'summarize' || !input.lookupContext
      ? ''
      : [
          '',
          'EXTERNAL_LOOKUP_CONTEXT:',
          formatLookupContext(input.lookupContext)
        ].join('\n');

  return renderPromptTemplate(loadPrompt('replyShell'), {
    assistantInstructions: input.assistantInstructions,
    assistantDisplayName: text.assistant.displayName,
    globalPrompt: loadPrompt('global'),
    targetDisplayName: sanitizePromptText(input.targetDisplayName),
    intent: input.intent,
    currentDateTime: sanitizePromptText(input.currentDateTime),
    intentPrompt: getIntentPrompt(input.intent),
    dataSections,
    lookupSections
  });
}

function getIntentPrompt(intent: ReplyGenerationIntent): string {
  switch (intent) {
    case 'summarize':
      return loadPrompt('summarize');
    case 'decide':
      return loadPrompt('decide');
    case 'read':
      return loadPrompt('read');
    case 'answer':
      return loadPrompt('answer');
    case 'translate':
      return loadPrompt('translate');
  }
}
