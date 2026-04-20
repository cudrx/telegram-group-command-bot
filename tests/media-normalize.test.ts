import { describe, expect, test } from 'vitest';

import {
  normalizeCloudflareVisionResponse,
  normalizeGladiaTranscriptionResult
} from '../src/media/normalize.js';

describe('normalizeCloudflareVisionResponse', () => {
  test('normalizes a direct provider object response', () => {
    expect(
      normalizeCloudflareVisionResponse({
        kind: 'screenshot',
        visible_text: ['Leon, necesito que distraigas a Kingpin'],
        names_mentioned_in_text: ['Leon', 'Kingpin', 123],
        visually_present_people_or_characters: [
          'Man in black mask and red logo',
          null
        ],
        objects: ['Light fixtures', 99],
        scene: 'Indoor setting',
        actions: ['standing', false],
        style: 'Dark and moody',
        uncertainty: ['context of scene', { note: 'maybe' }]
      })
    ).toEqual({
      type: 'vision',
      kind: 'screenshot',
      visibleText: ['Leon, necesito que distraigas a Kingpin'],
      namesMentionedInText: ['Leon', 'Kingpin'],
      visuallyPresentPeopleOrCharacters: ['Man in black mask and red logo'],
      objects: ['Light fixtures'],
      scene: 'Indoor setting',
      actions: ['standing'],
      style: 'Dark and moody',
      uncertainty: ['context of scene']
    });
  });

  test('normalizes a wrapped JSON string response', () => {
    expect(
      normalizeCloudflareVisionResponse(
        JSON.stringify({
          success: true,
          result: {
            response: {
              kind: 'meme',
              visible_text: ['CAPTION'],
              names_mentioned_in_text: ['CAPTION'],
              visually_present_people_or_characters: ['smiling person'],
              objects: ['phone'],
              scene: 'outdoors',
              actions: ['holding phone'],
              style: 'bright',
              uncertainty: []
            }
          }
        })
      )
    ).toEqual({
      type: 'vision',
      kind: 'meme',
      visibleText: ['CAPTION'],
      namesMentionedInText: ['CAPTION'],
      visuallyPresentPeopleOrCharacters: ['smiling person'],
      objects: ['phone'],
      scene: 'outdoors',
      actions: ['holding phone'],
      style: 'bright',
      uncertainty: []
    });
  });

  test('normalizes common wrapper keys', () => {
    expect(
      normalizeCloudflareVisionResponse({
        payload: {
          kind: 'photo',
          visible_text: ['wrapped'],
          scene: 'desk'
        }
      })
    ).toMatchObject({
      kind: 'photo',
      visibleText: ['wrapped'],
      scene: 'desk'
    });
  });

  test('defaults invalid or missing fields', () => {
    expect(
      normalizeCloudflareVisionResponse({
        kind: 123,
        visible_text: null,
        names_mentioned_in_text: ['ok', 1, false],
        visually_present_people_or_characters: undefined,
        objects: 'not-an-array',
        scene: 99,
        actions: null,
        style: undefined,
        uncertainty: [null, 'maybe']
      })
    ).toEqual({
      type: 'vision',
      kind: 'other',
      visibleText: [],
      namesMentionedInText: ['ok'],
      visuallyPresentPeopleOrCharacters: [],
      objects: [],
      scene: '',
      actions: [],
      style: '',
      uncertainty: ['maybe']
    });
  });
});

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
