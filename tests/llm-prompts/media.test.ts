import { describe, expect, test } from 'vitest';

import { buildIntentPrompt } from '../../src/llm/prompts.js';
import { createPromptReplyContext } from './support.js';

const mediaContext = {
  sourceCaption: 'unique media caption',
  visionDescription: 'unique vision description',
  ocrTextRu: 'УНИКАЛЬНЫЙ OCR RU',
  ocrTextDefault: 'UNIQUE OCR DEFAULT',
  visionRaw: 'unique raw vision output',
  visionInterpretation: 'unique interpreted vision output',
  audioTranscript: {
    transcript: 'unique audio transcript',
    language: 'en',
    sourceDurationSeconds: 12
  }
};

describe('buildIntentPrompt media context', () => {
  test.each([
    'read',
    'answer'
  ] as const)('includes every supplied media artifact for %s', (intent) => {
    const prompt = buildIntentPrompt({
      assistantInstructions: 'custom assistant instructions',
      targetDisplayName: 'Tom',
      intent,
      currentDateTime: 'Sunday, 10 May 2026, 19:09 Moscow time',
      replyContext: createPromptReplyContext(`/${intent} command-only-secret`),
      mediaContext
    });

    const expectedValues = [
      mediaContext.sourceCaption,
      mediaContext.visionDescription,
      mediaContext.ocrTextRu,
      mediaContext.ocrTextDefault,
      mediaContext.visionRaw,
      mediaContext.visionInterpretation,
      ...(intent === 'read' ? [mediaContext.audioTranscript.transcript] : [])
    ];

    for (const value of expectedValues) {
      expect(prompt).toContain(value);
    }
    if (intent === 'answer') {
      expect(prompt).not.toContain(mediaContext.audioTranscript.transcript);
    }
    expect(prompt).not.toContain('command-only-secret');
  });

  test('serializes absent media fields without leaking command arguments', () => {
    const prompt = buildIntentPrompt({
      assistantInstructions: 'custom assistant instructions',
      targetDisplayName: 'Tom',
      intent: 'read',
      currentDateTime: 'Sunday, 10 May 2026, 19:09 Moscow time',
      replyContext: createPromptReplyContext('/read command-only-secret'),
      mediaContext: {
        sourceCaption: null,
        visionDescription: null,
        ocrTextRu: null,
        ocrTextDefault: null,
        visionRaw: null,
        visionInterpretation: null,
        audioTranscript: null
      }
    });

    expect(prompt).toContain('null');
    expect(prompt).not.toContain('command-only-secret');
  });
});
