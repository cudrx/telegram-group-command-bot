import { describe, expect, test } from 'vitest';

import {
  collectTranslateBlocks,
  filterTranslatableBlocks,
  looksRussian
} from '../../../src/app/chat-orchestrator/translate/blocks.js';
import type { StoredMessage } from '../../../src/domain/models.js';
import type { DescribeMediaContext } from '../../../src/llm/prompts.js';

const baseTarget: StoredMessage = {
  chatId: 1,
  messageId: 10,
  userId: 42,
  senderDisplayName: 'Alice',
  text: '',
  createdAt: '2026-04-03T12:00:00.000Z',
  isBot: false,
  replyToMessageId: null
};

const emptyMediaContext: DescribeMediaContext = {
  sourceCaption: null,
  visionDescription: null,
  ocrTextRu: null,
  ocrTextDefault: null,
  visionRaw: null,
  visionInterpretation: null,
  audioTranscript: null
};

describe('translate blocks', () => {
  test('collects message text, caption, OCR, and transcript blocks in display order', () => {
    const blocks = collectTranslateBlocks({
      targetMessage: { ...baseTarget, text: 'Hello' },
      mediaContext: {
        ...emptyMediaContext,
        sourceCaption: 'photo caption',
        ocrTextDefault: 'SALE TODAY',
        audioTranscript: {
          transcript: 'voice note',
          language: 'en',
          sourceDurationSeconds: 2
        }
      }
    });

    expect(blocks).toEqual([
      { kind: 'message_text', header: 'Текст сообщения', text: 'Hello' },
      { kind: 'caption', header: 'Подпись', text: 'photo caption' },
      { kind: 'image_text', header: 'Текст на картинке', text: 'SALE TODAY' },
      {
        kind: 'audio_transcript',
        header: 'Расшифровка аудио',
        text: 'voice note'
      }
    ]);
  });

  test('uses image description only when OCR text is absent', () => {
    expect(
      collectTranslateBlocks({
        targetMessage: baseTarget,
        mediaContext: {
          ...emptyMediaContext,
          ocrTextDefault: 'OPEN',
          visionDescription: 'A sign that says open'
        }
      }).map((block) => block.header)
    ).toEqual(['Текст на картинке']);

    expect(
      collectTranslateBlocks({
        targetMessage: baseTarget,
        mediaContext: {
          ...emptyMediaContext,
          visionInterpretation: 'A person points at a calendar'
        }
      })
    ).toEqual([
      {
        kind: 'image_description',
        header: 'Описание изображения',
        text: 'A person points at a calendar'
      }
    ]);
  });

  test('trims empty source blocks', () => {
    expect(
      collectTranslateBlocks({
        targetMessage: { ...baseTarget, text: '   ' },
        mediaContext: {
          ...emptyMediaContext,
          sourceCaption: '\n\t'
        }
      })
    ).toEqual([]);
  });

  test('detects ordinary Russian text without treating all Cyrillic as Russian', () => {
    expect(looksRussian('Привет, как дела?')).toBe(true);
    expect(looksRussian('Спасибо')).toBe(true);
    expect(looksRussian('Хорошо')).toBe(true);
    expect(looksRussian('Москва')).toBe(true);
    expect(looksRussian('Hello, how are you?')).toBe(false);
    expect(looksRussian('Добар дан')).toBe(false);
  });

  test('filters already-Russian blocks independently', () => {
    const blocks = [
      { kind: 'caption' as const, header: 'Подпись', text: 'Уже на русском' },
      { kind: 'image_text' as const, header: 'Текст на картинке', text: 'OPEN' }
    ];

    expect(filterTranslatableBlocks(blocks)).toEqual([blocks[1]]);
  });
});
