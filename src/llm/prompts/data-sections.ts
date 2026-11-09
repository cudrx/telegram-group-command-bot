import type {
  ReplyContext,
  ReplyGenerationIntent
} from '../../domain/models.js';
import { patterns, text } from '../../locales/locale.js';
import { formatJsonForPrompt, sanitizePromptText } from './sanitize.js';
import {
  formatCommandMessage,
  formatReplyContextMessages,
  formatReplyContextMetadata,
  formatSingleMessage
} from './transcript.js';
import type { DescribeMediaContext, PromptMessage } from './types.js';

export function getIntentDataSections(input: {
  intent: ReplyGenerationIntent;
  replyContext: ReplyContext;
  mediaContext?: DescribeMediaContext | null;
}): string {
  const { replyContext } = input;
  if (input.intent === 'answer' || input.intent === 'read') {
    const media = formatMediaSections(input.mediaContext);
    const context = formatContext(
      replyContext.priorContextMessages,
      replyContext.contextMetadata
    );
    if (input.intent === 'read') {
      return formatSections({
        CURRENT_COMMAND_MESSAGE: formatCommandMessage(
          replyContext.triggerMessage
        ),
        ...media,
        CHAT_CONTEXT: context
      });
    }

    return formatSections({
      TARGET_MESSAGE_TO_ANSWER: formatSingleMessage(
        replyContext.replyAnchorMessage
      ),
      TARGET_MEDIA_CAPTION: media.CAPTION,
      TARGET_MEDIA_OCR_TEXT_RU: media.OCR_TEXT_RU,
      TARGET_MEDIA_OCR_TEXT_DEFAULT: media.OCR_TEXT_DEFAULT,
      TARGET_MEDIA_VISION_DESCRIPTION: media.VISION_DESCRIPTION,
      TARGET_MEDIA_RAW: media.VISION_RAW,
      TARGET_MEDIA_INTERPRETATION: media.VISION_INTERPRETATION,
      TARGET_AUDIO_TRANSCRIPT: media.AUDIO_TRANSCRIPT,
      CONVERSATION_CANDIDATES: context,
      CURRENT_REQUEST: formatSingleMessage(replyContext.triggerMessage)
    });
  }

  const translationContextMessages = replyContext.priorContextMessages
    .filter(
      (message) =>
        message.messageId !== replyContext.replyAnchorMessage?.messageId
    )
    .slice(-3);

  return formatSections({
    TARGET_MESSAGE_TO_TRANSLATE: formatSingleMessage(
      replyContext.replyAnchorMessage
    ),
    TRANSLATE_BLOCKS: formatTranslateBlocksForPrompt(
      replyContext.replyAnchorMessage?.text
    ),
    TRANSLATION_CONTEXT_DO_NOT_TRANSLATE: formatContext(
      translationContextMessages,
      {
        truncated: replyContext.contextMetadata?.truncated ?? false,
        includedMessageCount: translationContextMessages.length
      }
    )
  });
}

function formatSections(sections: Record<string, string>): string {
  return Object.entries(sections)
    .map(([name, content]) => `${name}:\n${content}`)
    .join('\n\n');
}

function formatContext(
  messages: PromptMessage[],
  metadata: ReplyContext['contextMetadata']
): string {
  return [
    formatReplyContextMetadata({ messages, metadata }),
    formatReplyContextMessages(messages)
  ].join('\n');
}

function formatMediaSections(media: DescribeMediaContext | null | undefined) {
  return {
    CAPTION: sanitizePromptText(media?.sourceCaption ?? 'No caption.'),
    OCR_TEXT_RU: sanitizePromptText(
      media?.ocrTextRu ?? 'No target-language OCR text.'
    ),
    OCR_TEXT_DEFAULT: sanitizePromptText(
      media?.ocrTextDefault ?? 'No default OCR text.'
    ),
    VISION_DESCRIPTION: sanitizePromptText(
      media?.visionDescription ?? 'No vision description.'
    ),
    VISION_RAW: sanitizePromptText(media?.visionRaw ?? 'No media raw context.'),
    VISION_INTERPRETATION: sanitizePromptText(
      media?.visionInterpretation ?? 'No media interpretation context.'
    ),
    AUDIO_TRANSCRIPT: formatJsonForPrompt(media?.audioTranscript ?? null)
  };
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
