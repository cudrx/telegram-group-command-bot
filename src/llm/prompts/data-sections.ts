import type {
  ReplyContext,
  ReplyGenerationIntent
} from '../../domain/models.js';
import { patterns, text } from '../../locales/locale.js';
import { loadPrompt } from '../prompt-files.js';
import { renderPromptTemplate } from './render.js';
import { formatJsonForPrompt, sanitizePromptText } from './sanitize.js';
import {
  formatCommandMessage,
  formatReplyContextMessages,
  formatSingleMessage
} from './transcript.js';
import type { DescribeMediaContext } from './types.js';

export function getIntentDataSections(input: {
  intent: ReplyGenerationIntent;
  replyContext: ReplyContext;
  mediaContext?: DescribeMediaContext | null;
}): string {
  if (input.intent === 'answer') {
    return renderPromptTemplate(loadPrompt('systemAnswer'), {
      targetMessage: formatSingleMessage(input.replyContext.replyAnchorMessage),
      targetMediaCaption: sanitizePromptText(
        input.mediaContext?.sourceCaption ?? 'No caption.'
      ),
      targetMediaOcrTextRu: sanitizePromptText(
        input.mediaContext?.ocrTextRu ?? 'No target-language OCR text.'
      ),
      targetMediaOcrTextDefault: sanitizePromptText(
        input.mediaContext?.ocrTextDefault ?? 'No default OCR text.'
      ),
      targetMediaVisionDescription: sanitizePromptText(
        input.mediaContext?.visionDescription ?? 'No vision description.'
      ),
      targetMediaRaw: sanitizePromptText(
        input.mediaContext?.visionRaw ?? 'No media raw context.'
      ),
      targetMediaInterpretation: sanitizePromptText(
        input.mediaContext?.visionInterpretation ??
          'No media interpretation context.'
      ),
      nearbyChatContext: formatReplyContextMessages(
        input.replyContext.priorContextMessages
      ),
      currentCommandMessage: formatCommandMessage(
        input.replyContext.triggerMessage
      ),
      targetLabel: 'TARGET_MESSAGE_TO_ANSWER',
      commandName: input.intent
    });
  }

  if (input.intent === 'read') {
    return renderPromptTemplate(loadPrompt('systemRead'), {
      currentCommandMessage: formatCommandMessage(
        input.replyContext.triggerMessage
      ),
      caption: sanitizePromptText(
        input.mediaContext?.sourceCaption ?? 'No caption.'
      ),
      ocrTextRu: sanitizePromptText(
        input.mediaContext?.ocrTextRu ?? 'No target-language OCR text.'
      ),
      ocrTextDefault: sanitizePromptText(
        input.mediaContext?.ocrTextDefault ?? 'No default OCR text.'
      ),
      visionDescription: sanitizePromptText(
        input.mediaContext?.visionDescription ?? 'No vision description.'
      ),
      visionRaw: sanitizePromptText(
        input.mediaContext?.visionRaw ?? 'No vision raw context.'
      ),
      visionInterpretation: sanitizePromptText(
        input.mediaContext?.visionInterpretation ??
          'No vision interpretation context.'
      ),
      audioTranscript: formatJsonForPrompt(
        input.mediaContext?.audioTranscript ?? null
      ),
      chatContext: formatReplyContextMessages(
        input.replyContext.priorContextMessages
      ),
      commandName: input.intent
    });
  }

  if (input.intent === 'translate') {
    return [
      'TARGET_MESSAGE_TO_TRANSLATE:',
      formatSingleMessage(input.replyContext.replyAnchorMessage),
      '',
      'TRANSLATE_BLOCKS:',
      formatTranslateBlocksForPrompt(
        input.replyContext.replyAnchorMessage?.text
      )
    ].join('\n');
  }

  return renderPromptTemplate(loadPrompt('systemGeneric'), {
    currentCommandMessage: formatCommandMessage(
      input.replyContext.triggerMessage
    ),
    chatContext: formatReplyContextMessages(
      input.replyContext.priorContextMessages
    )
  });
}

function formatTranslateBlocksForPrompt(
  sourceText: string | undefined
): string {
  const sanitized = sanitizePromptText(sourceText ?? '');

  if (patterns.translate.blockHeaderAtStart.test(sanitized)) {
    return sanitized;
  }

  return [`${text.translate.headers.messageText}:`, sanitized].join('\n');
}
