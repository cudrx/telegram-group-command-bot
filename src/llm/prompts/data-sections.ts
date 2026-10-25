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
  formatReplyContextMetadata,
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
      targetAudioTranscript: formatJsonForPrompt(
        input.mediaContext?.audioTranscript ?? null
      ),
      nearbyChatContext: [
        formatReplyContextMetadata({
          messages: input.replyContext.priorContextMessages,
          metadata: input.replyContext.contextMetadata
        }),
        formatReplyContextMessages(input.replyContext.priorContextMessages)
      ].join('\n'),
      currentCommandMessage: formatSingleMessage(
        input.replyContext.triggerMessage
      )
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
      chatContext: [
        formatReplyContextMetadata({
          messages: input.replyContext.priorContextMessages,
          metadata: input.replyContext.contextMetadata
        }),
        formatReplyContextMessages(input.replyContext.priorContextMessages)
      ].join('\n'),
      commandName: input.intent
    });
  }

  {
    const translationContextMessages = input.replyContext.priorContextMessages
      .filter(
        (message) =>
          message.messageId !== input.replyContext.replyAnchorMessage?.messageId
      )
      .slice(-3);

    return [
      'TARGET_MESSAGE_TO_TRANSLATE:',
      formatSingleMessage(input.replyContext.replyAnchorMessage),
      '',
      'TRANSLATE_BLOCKS:',
      formatTranslateBlocksForPrompt(
        input.replyContext.replyAnchorMessage?.text
      ),
      '',
      'TRANSLATION_CONTEXT_DO_NOT_TRANSLATE:',
      formatReplyContextMetadata({
        messages: translationContextMessages,
        metadata: {
          truncated: input.replyContext.contextMetadata?.truncated ?? false,
          includedMessageCount: translationContextMessages.length
        }
      }),
      formatReplyContextMessages(translationContextMessages)
    ].join('\n');
  }
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
