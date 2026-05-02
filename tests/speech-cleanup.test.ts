import { describe, expect, test } from 'vitest';

import { normalizeSpeechText } from '../src/tts/speech-cleanup.js';

describe('normalizeSpeechText', () => {
  test('removes simple html and decodes entities', () => {
    expect(normalizeSpeechText('<b>Привет</b> &amp; пока', 50)).toEqual({
      ok: true,
      text: 'Привет & пока'
    });
  });

  test('keeps a simple leading username without @', () => {
    expect(normalizeSpeechText('@artyom да, звучит норм', 50)).toEqual({
      ok: true,
      text: 'artyom да, звучит норм'
    });
  });

  test('rejects links', () => {
    expect(normalizeSpeechText('держи https://example.com', 100)).toEqual({
      ok: false,
      reason: 'link'
    });
  });

  test('rejects code and json looking text', () => {
    expect(normalizeSpeechText('`npm run test`', 100)).toEqual({
      ok: false,
      reason: 'code'
    });
    expect(normalizeSpeechText('{"ok":true}', 100)).toEqual({
      ok: false,
      reason: 'structured'
    });
  });

  test('rejects lists and too many line breaks', () => {
    expect(normalizeSpeechText('- one\n- two', 100)).toEqual({
      ok: false,
      reason: 'structured'
    });
    expect(normalizeSpeechText('a\nb\nc\nd', 100)).toEqual({
      ok: false,
      reason: 'structured'
    });
  });

  test('rejects tables and multiple mentions', () => {
    expect(normalizeSpeechText('| a | b |', 100)).toEqual({
      ok: false,
      reason: 'structured'
    });
    expect(normalizeSpeechText('@one привет @two', 100)).toEqual({
      ok: false,
      reason: 'mention'
    });
  });

  test('rejects empty, too long, and lossy cleaned text', () => {
    expect(normalizeSpeechText('   ', 10)).toEqual({
      ok: false,
      reason: 'empty'
    });
    expect(normalizeSpeechText('а'.repeat(11), 10)).toEqual({
      ok: false,
      reason: 'length'
    });
    expect(normalizeSpeechText('<span data-x="1">ок</span>', 100)).toEqual({
      ok: false,
      reason: 'content_loss'
    });
  });
});
