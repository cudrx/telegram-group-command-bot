import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from './support.js';

describe('ChatOrchestrator media read', () => {
  test('returns local read disabled placeholder when media analysis is off', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Распознавание медиа сейчас выключено.'
    });
  });

  test('returns read usage when command is not a reply to media', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('не надо'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      env: { mediaAnalysisEnabled: true }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(generateReply).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Сделай reply на голосовое, кружочек или картинку и отправь /read.'
    });
  });

  test('recognizes replied voice media, caches artifact, and sends media context to LLM', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'контекст перед войсом',
        createdAt: '2026-04-03T12:00:00.000Z'
      })
    );
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('привет из войса'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const transcribe = vi.fn().mockResolvedValue({
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifact: {
        type: 'transcript',
        transcript: 'привет из войса',
        language: 'ru',
        duration: 3
      },
      rawResponse: { status: 'done' },
      sourceDurationSeconds: 3
    });
    const cleanupFetch = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'voice/file.ogg' })
      },
      fetch: cleanupFetch as typeof fetch,
      speechToTextProvider: { transcribe }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 90,
        replyToMediaSnapshot: {
          messageId: 90,
          mediaKind: 'voice',
          fileId: 'voice-file',
          fileUniqueId: 'voice-unique',
          mimeType: 'audio/ogg',
          fileSize: 3,
          durationSeconds: 3,
          caption: null
        }
      })
    );

    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'voice-90.ogg',
        mimeType: 'audio/ogg'
      })
    );
    expect(db.savedMediaArtifacts).toHaveLength(1);
    expect(db.savedMediaArtifacts[0]).toMatchObject({
      fileUniqueId: 'voice-unique',
      provider: 'gladia',
      artifactKind: 'transcript',
      artifactText: 'привет из войса'
    });
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'read',
        mediaContext: {
          sourceCaption: null,
          visionDescription: null,
          ocrTextRu: null,
          ocrTextDefault: null,
          visionRaw: null,
          visionInterpretation: null,
          audioTranscript: {
            transcript: 'привет из войса',
            language: 'ru',
            sourceDurationSeconds: 3
          }
        }
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'привет из войса'
    });
  });

  test('reads replied image through vision description plus OCR cache layers', async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('Интерпретация картинки'));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    });
    const describe = vi.fn().mockResolvedValue({
      provider: 'cloudflare',
      providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
      rawText: 'A gold medal with a person at a computer.',
      rawResponse: { response: 'A gold medal with a person at a computer.' }
    });
    const extractText = vi.fn().mockImplementation(async (input) => ({
      provider: 'ocr_space',
      providerModel: 'ocr-model',
      text: 'ГОРЖУСЬ',
      language: input.language,
      rawResponse: { status: 'ok', language: input.language }
    }));
    const cleanupFetch = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      env: { mediaAnalysisEnabled: true },
      telegramFileApi: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
      },
      fetch: cleanupFetch as typeof fetch,
      visionProvider: { describe },
      ocrProvider: { extractText }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
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
      })
    );

    expect(describe).toHaveBeenCalledTimes(1);
    expect(extractText).toHaveBeenCalledTimes(2);
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'read',
        mediaContext: expect.objectContaining({
          visionDescription: 'A gold medal with a person at a computer.',
          ocrTextRu: 'ГОРЖУСЬ',
          ocrTextDefault: 'ГОРЖУСЬ'
        })
      })
    );
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Интерпретация картинки'
    });
  });
});
