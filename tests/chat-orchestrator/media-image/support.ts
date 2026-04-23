import { vi } from 'vitest';

import type { SaveMediaArtifactInput } from '../../../src/database/index.js';
import {
  createIncomingMessage,
  createReplyResult,
  type FakeDatabaseClient
} from '../support.js';

export function createReadImageMessage() {
  return createIncomingMessage({
    messageId: 2,
    text: '/read',
    entities: [{ type: 'bot_command', offset: 0, length: 5 }],
    replyToMessageId: 90,
    replyToMediaSnapshot: {
      messageId: 90,
      mediaKind: 'photo',
      fileId: 'photo-file',
      fileUniqueId: 'photo-unique',
      mimeType: 'image/jpeg',
      fileSize: 3,
      durationSeconds: null,
      caption: 'подпись к фото'
    }
  });
}

export function saveImageArtifact(
  db: FakeDatabaseClient,
  overrides: Partial<SaveMediaArtifactInput>
): void {
  db.saveMediaArtifact({
    fileUniqueId: 'photo-unique',
    chatId: 1,
    telegramMessageId: 90,
    mediaKind: 'photo',
    provider: 'cloudflare',
    providerModel: 'cf-model',
    artifactKind: 'vision_description',
    artifactStatus: 'success',
    artifactText: 'Visual description',
    artifactJson: { text: 'Visual description' },
    rawResponseJson: { response: 'Visual description' },
    sourceCaption: 'подпись к фото',
    sourceMimeType: 'image/jpeg',
    sourceFileSize: 3,
    sourceDurationSeconds: null,
    recognitionLanguage: null,
    confidenceJson: null,
    errorText: null,
    createdAt: '2026-04-03T12:00:01.000Z',
    expiresAt: '2026-04-10T12:00:01.000Z',
    ...overrides
  });
}

export function saveOcrArtifact(
  db: FakeDatabaseClient,
  input: {
    artifactKind: 'ocr_text_ru' | 'ocr_text_default';
    text: string;
    language: 'rus' | null;
    createdAt?: string;
  }
): void {
  saveImageArtifact(db, {
    provider: 'ocr_space',
    providerModel: 'ocr-model',
    artifactKind: input.artifactKind,
    artifactText: input.text,
    artifactJson: { text: input.text },
    rawResponseJson: { status: 'ok', language: input.language },
    recognitionLanguage: input.language,
    createdAt: input.createdAt ?? '2026-04-03T12:00:02.000Z',
    expiresAt: input.createdAt
      ? input.createdAt.replace('2026-04-03', '2026-04-10')
      : '2026-04-10T12:00:02.000Z'
  });
}

export function saveVisionDescription(
  db: FakeDatabaseClient,
  text = 'Visual description'
): void {
  saveImageArtifact(db, {
    provider: 'cloudflare',
    providerModel: 'cf-model',
    artifactKind: 'vision_description',
    artifactText: text,
    artifactJson: { text },
    rawResponseJson: { response: text }
  });
}

export function saveVisionRaw(
  db: FakeDatabaseClient,
  text = 'Legacy raw image description'
): void {
  saveImageArtifact(db, {
    provider: 'cloudflare',
    providerModel: 'cf-model',
    artifactKind: 'vision_raw',
    artifactText: text,
    artifactJson: { text },
    rawResponseJson: { response: text }
  });
}

export function saveVisionInterpretation(
  db: FakeDatabaseClient,
  text = 'Cached interpretation text'
): void {
  saveImageArtifact(db, {
    provider: 'deepseek',
    providerModel: 'reply-model',
    artifactKind: 'vision_interpretation',
    artifactText: text,
    artifactJson: { text },
    rawResponseJson: { model: 'reply-model' },
    createdAt: '2026-04-03T12:00:03.000Z',
    expiresAt: '2026-04-10T12:00:03.000Z'
  });
}

export function createReplyDispatcher() {
  return vi.fn().mockResolvedValue({
    messageId: 1001,
    createdAt: '2026-04-03T12:00:30.000Z'
  });
}

export function createSuccessfulDownloadDeps() {
  return {
    telegramFileApi: {
      getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
    },
    fetch: vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]))
      ) as typeof fetch
  };
}

export function createVisionProvider(rawText: string) {
  return {
    describe: vi.fn().mockResolvedValue({
      provider: 'cloudflare',
      providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
      rawText,
      rawResponse: { response: rawText }
    })
  };
}

export function createOcrProvider(getText: (language: 'rus' | null) => string) {
  return {
    extractText: vi.fn().mockImplementation(async (input) => ({
      provider: 'ocr_space',
      providerModel: 'ocr-model',
      text: getText(input.language),
      language: input.language,
      rawResponse: { status: 'ok', language: input.language }
    }))
  };
}

export function createReplyResultStub(text: string) {
  return vi.fn().mockResolvedValue(createReplyResult(text));
}
