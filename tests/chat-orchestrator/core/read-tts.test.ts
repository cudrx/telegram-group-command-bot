import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createOrchestrator,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator /read TTS command', () => {
  test('reads replied-to text messages as voice', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'прочитай меня',
        fromDisplayName: 'Other Bot',
        isBot: true
      })
    );
    const synthesize = vi.fn().mockResolvedValue({
      provider: 'yandex_speechkit',
      providerModel: 'speechkit-v1',
      audioBytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/ogg'
    });
    const voiceDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const replyDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      textToSpeechProvider: { synthesize },
      voiceDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 1,
        replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 1)
      })
    );

    expect(synthesize).toHaveBeenCalledWith({
      text: 'прочитай меня',
      timeoutMs: expect.any(Number)
    });
    expect(voiceDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        replyToMessageId: 2,
        audioBytes: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/ogg'
      })
    );
    expect(replyDispatcher).not.toHaveBeenCalled();
    expect(db.getChatState(1)).toMatchObject({
      readLastVoiceAt: '2026-04-13T09:00:10.000Z'
    });
    expect(db.getMessageByTelegramMessageId(1, 1001)).toMatchObject({
      text: 'прочитай меня',
      outputMode: 'voice',
      isBot: true
    });
  });

  test('falls back when /read is not a reply to readable text', async () => {
    const db = new FakeDatabaseClient();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1002,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      textToSpeechProvider: null
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Сделай reply на текстовое сообщение и отправь /read.'
    });
  });

  test('falls back when replied-to text is too long', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'а'.repeat(501)
      })
    );
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1003,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      textToSpeechProvider: { synthesize: vi.fn() }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 1,
        replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 1)
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Сообщение слишком длинное, я могу прочитать только до 500 символов.'
    });
  });

  test('falls back with remaining cooldown minutes', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({ messageId: 1, text: 'текст' })
    );
    db.updateChatTtsState({
      chatId: 1,
      readLastVoiceAt: '2026-04-13T08:30:10.000Z'
    });
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1004,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      textToSpeechProvider: { synthesize: vi.fn() }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 1,
        replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 1)
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Я уже читал сообщение в этом чате недавно. Попробуй через 30 мин.'
    });
  });

  test('sends provider failure fallback for explicit read', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({ messageId: 1, text: 'текст' })
    );
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1005,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher,
      textToSpeechProvider: {
        synthesize: vi.fn().mockRejectedValue(new Error('tts down'))
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/read',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
        replyToMessageId: 1,
        replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 1)
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Не удалось озвучить сообщение. Попробуй позже.'
    });
  });
});
