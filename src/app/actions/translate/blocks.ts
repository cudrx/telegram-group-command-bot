import type { StoredMessage } from '../../../domain/models.js';
import type { DescribeMediaContext } from '../../../llm/prompts.js';
import { patterns, text } from '../../../locales/locale.js';

export type TranslateBlockKind =
  | 'message_text'
  | 'caption'
  | 'image_text'
  | 'audio_transcript'
  | 'image_description';

export type TranslateBlock = {
  kind: TranslateBlockKind;
  header: string;
  text: string;
};

type CandidateTranslateBlock = Omit<TranslateBlock, 'text'> & {
  text: string | null;
};

const TRANSLATE_BLOCK_HEADERS = text.translate.headers;
const LANGUAGE_DETECTION_PATTERNS = patterns.languageDetection;

export function collectTranslateBlocks(input: {
  targetMessage: StoredMessage | null;
  mediaContext: DescribeMediaContext | null;
}): TranslateBlock[] {
  const blocks: TranslateBlock[] = [];
  const targetText = input.targetMessage?.text ?? null;
  const mediaCaption =
    input.mediaContext?.sourceCaption ??
    input.targetMessage?.mediaSnapshot?.caption ??
    null;

  if (!isSameNonEmptyText(targetText, mediaCaption)) {
    addBlock(blocks, {
      kind: 'message_text',
      header: TRANSLATE_BLOCK_HEADERS.messageText,
      text: cleanMessageOrCaptionText(targetText)
    });
  }

  const ocrText =
    input.mediaContext?.ocrTextRu || input.mediaContext?.ocrTextDefault || null;

  addBlock(blocks, {
    kind: 'image_text',
    header: TRANSLATE_BLOCK_HEADERS.imageText,
    text: ocrText
  });

  addBlock(blocks, {
    kind: 'audio_transcript',
    header: TRANSLATE_BLOCK_HEADERS.audioTranscript,
    text: input.mediaContext?.audioTranscript?.transcript ?? null
  });

  if (!ocrText) {
    addBlock(blocks, {
      kind: 'image_description',
      header: TRANSLATE_BLOCK_HEADERS.imageDescription,
      text:
        input.mediaContext?.visionInterpretation ??
        input.mediaContext?.visionDescription ??
        null
    });
  }

  addBlock(blocks, {
    kind: 'caption',
    header: TRANSLATE_BLOCK_HEADERS.caption,
    text: cleanMessageOrCaptionText(mediaCaption)
  });

  return blocks;
}

export function createTranslateBlockMessage(
  targetMessage: StoredMessage,
  blocks: TranslateBlock[]
): StoredMessage {
  return {
    ...targetMessage,
    text: formatTranslateBlocks(blocks)
  };
}

export function filterTranslatableBlocks(
  blocks: TranslateBlock[]
): TranslateBlock[] {
  return blocks.filter((block) => !looksLikeTargetLanguage(block.text));
}

export function looksLikeTargetLanguage(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\p{L}\p{N}_-]+/gu, ' ');
  const cyrillicLetters = normalized.match(/\p{Script=Cyrillic}/gu) ?? [];

  if (cyrillicLetters.length < 3) {
    return false;
  }

  const targetLanguageSpecificLetters =
    normalized.match(LANGUAGE_DETECTION_PATTERNS.specificLetters) ?? [];
  const commonTargetLanguageWords =
    normalized.match(LANGUAGE_DETECTION_PATTERNS.commonWords) ?? [];
  const commonTargetLanguageShortText =
    normalized.match(LANGUAGE_DETECTION_PATTERNS.commonShortText) ?? [];

  return (
    targetLanguageSpecificLetters.length > 0 ||
    commonTargetLanguageWords.length >= 1 ||
    commonTargetLanguageShortText.length >= 1
  );
}

export function formatTranslateBlocks(blocks: TranslateBlock[]): string {
  return blocks.map((block) => `${block.header}:\n${block.text}`).join('\n\n');
}

function addBlock(
  blocks: TranslateBlock[],
  block: CandidateTranslateBlock
): void {
  const text = block.text?.trim() ?? '';

  if (!text) {
    return;
  }

  blocks.push({ ...block, text });
}

function isSameNonEmptyText(
  messageText: string | null,
  captionText: string | null
): boolean {
  const normalizedMessageText = normalizeSourceIdentity(messageText);
  const normalizedCaptionText = normalizeSourceIdentity(captionText);

  return (
    normalizedMessageText.length > 0 &&
    normalizedMessageText === normalizedCaptionText
  );
}

function normalizeSourceIdentity(text: string | null): string {
  return (text ?? '')
    .replace(/\s+href=["']https?:\/\/[^"']*["']/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\(\s*https?:\/\/[^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanMessageOrCaptionText(text: string | null): string | null {
  if (!text) {
    return null;
  }

  return text
    .split('\n')
    .filter((line) => !isRedditAttributionLine(line))
    .join('\n')
    .trim();
}

function isRedditAttributionLine(line: string): boolean {
  const normalized = line
    .replace(/\s+href=["']https?:\/\/[^"']*["']/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\(\s*https?:\/\/[^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return /^r\/[A-Za-z0-9_]+(?:\s*·\s*↑?\d+)?$/u.test(normalized);
}
