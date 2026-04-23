import { describe, expect, test } from 'vitest';

import { normalizeGladiaTranscriptionResult } from '../src/media/normalize.js';

describe('normalizeGladiaTranscriptionResult', () => {
  test('normalizes the fuller Gladia result shape', () => {
    expect(
      normalizeGladiaTranscriptionResult({
        result: {
          transcription: {
            full_transcript: 'привет'
          },
          metadata: {
            language: 'ru',
            audio_duration: 13.96
          }
        }
      })
    ).toEqual({
      type: 'transcript',
      transcript: 'привет',
      language: 'ru',
      duration: 13.96
    });
  });

  test('normalizes Gladia language from nested audio metadata', () => {
    expect(
      normalizeGladiaTranscriptionResult({
        body: {
          result: {
            transcription: {
              full_transcript: 'hello'
            },
            audio_metadata: {
              language: 'en',
              audio_duration: 2.5
            }
          }
        }
      })
    ).toEqual({
      type: 'transcript',
      transcript: 'hello',
      language: 'en',
      duration: 2.5
    });
  });

  test('normalizes the smoke Gladia result shape', () => {
    expect(
      normalizeGladiaTranscriptionResult({
        status: 'done',
        transcript: 'hello world',
        language: 'en'
      })
    ).toEqual({
      type: 'transcript',
      transcript: 'hello world',
      language: 'en',
      duration: null
    });
  });

  test('defaults a missing transcript to an empty string', () => {
    expect(
      normalizeGladiaTranscriptionResult({
        result: {
          transcription: {
            full_transcript: null
          },
          metadata: {
            language: null
          }
        }
      })
    ).toEqual({
      type: 'transcript',
      transcript: '',
      language: null,
      duration: null
    });
  });
});
