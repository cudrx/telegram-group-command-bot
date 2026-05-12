import type { StoredMessage } from '../../../domain/models.js';
import type { DescribeMediaContext } from '../../../llm/prompts.js';

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
      header: 'Текст сообщения',
      text: targetText
    });
  }

  addBlock(blocks, {
    kind: 'caption',
    header: 'Подпись',
    text: mediaCaption
  });

  const ocrText =
    input.mediaContext?.ocrTextRu || input.mediaContext?.ocrTextDefault || null;

  addBlock(blocks, {
    kind: 'image_text',
    header: 'Текст на картинке',
    text: ocrText
  });

  addBlock(blocks, {
    kind: 'audio_transcript',
    header: 'Расшифровка аудио',
    text: input.mediaContext?.audioTranscript?.transcript ?? null
  });

  if (!ocrText) {
    addBlock(blocks, {
      kind: 'image_description',
      header: 'Описание изображения',
      text:
        input.mediaContext?.visionInterpretation ??
        input.mediaContext?.visionDescription ??
        null
    });
  }

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
  return blocks.filter((block) => !looksRussian(block.text));
}

export function looksRussian(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\p{L}\p{N}_-]+/gu, ' ');
  const cyrillicLetters = normalized.match(/\p{Script=Cyrillic}/gu) ?? [];

  if (cyrillicLetters.length < 3) {
    return false;
  }

  const russianSpecificLetters = normalized.match(/[ёыэъ]/gu) ?? [];
  const commonRussianWords =
    normalized.match(
      /(?:^|[^\p{L}])(и|в|во|не|на|что|это|как|дела|привет|я|ты|он|она|мы|вы|они|уже|русском|русский|для|с|со|по|из|за|к|ко|от|до)(?=$|[^\p{L}])/gu
    ) ?? [];
  const commonRussianShortText =
    normalized.match(
      /(?:^|[^\p{L}])(спасибо|хорошо|понял|поняла|понятно|согласен|согласна|можно|нельзя|давай|ладно|москва)(?=$|[^\p{L}])/gu
    ) ?? [];

  return (
    russianSpecificLetters.length > 0 ||
    commonRussianWords.length >= 1 ||
    commonRussianShortText.length >= 1
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
    .replace(/\(\s*https?:\/\/[^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
