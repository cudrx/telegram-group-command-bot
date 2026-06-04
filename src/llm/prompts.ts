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
  const promptName = getIntentPromptName(intent);
  const sections = text.llm.sections;

  return renderPromptTemplate(loadPrompt(promptName), {
    decidePositionsLabel: sections.decide.positions,
    decideEvidenceLabel: sections.decide.evidence,
    decideVerdictLabel: sections.decide.verdict,
    summarizeShortSummaryLabel: sections.summarize.shortSummary,
    summarizeTakeawayLabel: sections.summarize.takeaway,
    readOriginalLabel: sections.read.original,
    readTranslationLabel: sections.read.translation
  });
}

function getIntentPromptName(
  intent: ReplyGenerationIntent
): Parameters<typeof loadPrompt>[0] {
  switch (intent) {
    case 'summarize':
      return 'summarize';
    case 'decide':
      return 'decide';
    case 'read':
      return 'read';
    case 'answer':
      return 'answer';
    case 'translate':
      return 'translate';
  }
}
