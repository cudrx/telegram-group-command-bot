import { describe, expect, test } from 'vitest';
import {
  formatWeeklyMessageLine,
  getWeeklyPreferredMediaSummary
} from '../../src/app/weekly/media.js';
import type { WeeklyMessage } from '../../src/app/weekly/types.js';
import type { StoredMediaArtifact } from '../../src/database/index.js';

function createArtifact(
  overrides: Partial<StoredMediaArtifact> = {}
): StoredMediaArtifact {
  return {
    id: 1,
    chatId: 1,
    telegramMessageId: 21,
    mediaKind: 'photo',
    fileUniqueId: 'file-21',
    provider: 'provider',
    providerModel: 'model',
    artifactKind: 'transcript',
    artifactStatus: 'success',
    artifactText: 'summary',
    artifactJson: null,
    rawResponseJson: null,
    sourceCaption: null,
    sourceMimeType: null,
    sourceFileSize: null,
    sourceDurationSeconds: null,
    recognitionLanguage: null,
    confidenceJson: null,
    errorText: null,
    createdAt: '2026-04-24T18:00:00.000Z',
    expiresAt: '2026-05-24T18:00:00.000Z',
    ...overrides
  };
}

describe('weekly media summaries', () => {
  test('prefers cached image summaries in the existing order', () => {
    const summary = getWeeklyPreferredMediaSummary(
      [
        createArtifact({
          artifactKind: 'vision_raw',
          artifactText: 'raw'
        }),
        createArtifact({
          artifactKind: 'ocr_text_ru',
          artifactText: 'текст'
        }),
        createArtifact({
          artifactKind: 'vision_interpretation',
          artifactText: 'мем про дедлайн'
        })
      ],
      {
        messageId: 21,
        mediaSnapshot: {
          messageId: 21,
          mediaKind: 'photo',
          fileId: 'photo-21',
          fileUniqueId: 'file-21',
          mimeType: null,
          fileSize: null,
          durationSeconds: null,
          caption: null
        }
      }
    );

    expect(summary).toBe('мем про дедлайн');
  });

  test('renders media kind and caption when no artifact exists', () => {
    expect(
      formatWeeklyMessageLine({
        chatId: 1,
        messageId: 22,
        mediaGroupId: null,
        userId: 42,
        senderDisplayName: 'Tom',
        text: '',
        createdAt: '2026-04-24T18:12:00.000Z',
        isBot: false,
        replyToMessageId: null,
        mediaSnapshot: {
          messageId: 22,
          mediaKind: 'voice',
          fileId: 'voice-22',
          fileUniqueId: 'voice-file-22',
          mimeType: null,
          fileSize: null,
          durationSeconds: null,
          caption: 'срочно послушайте'
        },
        mediaSummary: null
      } satisfies WeeklyMessage)
    ).toContain('[voice] срочно послушайте');
  });

  test('does not duplicate media caption already stored as message text', () => {
    const line = formatWeeklyMessageLine({
      chatId: 1,
      messageId: 23,
      mediaGroupId: null,
      userId: 42,
      senderDisplayName: 'Tom',
      text: 'срочно послушайте',
      createdAt: '2026-04-24T18:12:00.000Z',
      isBot: false,
      replyToMessageId: null,
      mediaSnapshot: {
        messageId: 23,
        mediaKind: 'voice',
        fileId: 'voice-23',
        fileUniqueId: 'voice-file-23',
        mimeType: null,
        fileSize: null,
        durationSeconds: null,
        caption: 'срочно послушайте'
      },
      mediaSummary: null
    } satisfies WeeklyMessage);

    expect(line).toBe('2026-04-24T18:12:00.000Z Tom: срочно послушайте');
  });
});
