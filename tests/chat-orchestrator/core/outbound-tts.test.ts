import { describe, expect, test, vi } from 'vitest';

import {
  createIncomingMessage,
  createOrchestrator,
  createReplyResult,
  FakeDatabaseClient
} from '../support.js';

describe('ChatOrchestrator opportunistic outbound TTS', () => {
  test('sends eligible answer as voice instead of text', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: 'что думаешь?'
      })
    );
    const generateReply = vi
      .fn()
      .mockResolvedValue(createReplyResult('да, звучит нормально'));
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
    const replyDispatcher = vi
      .fn()
      .mockResolvedValueOnce({
        messageId: 9001,
        createdAt: '2026-04-13T09:00:20.000Z'
      })
      .mockResolvedValueOnce({
        messageId: 9002,
        createdAt: '2026-04-13T09:00:21.000Z'
      });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher,
      textToSpeechProvider: { synthesize },
      voiceDispatcher,
      random: () => 0,
      initialChatTtsState: {
        answerLastOutputMode: 'text',
        answerEligibleTextSinceVoice: 3,
        answerEligibleTextStreak: 3,
        readLastVoiceAt: null
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 1,
        replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 1)
      })
    );

    expect(voiceDispatcher).toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenNthCalledWith(1, {
      chatId: 1,
      replyToMessageId: 2,
      text: 'Пишет ответ'
    });
    expect(replyDispatcher).toHaveBeenNthCalledWith(2, {
      chatId: 1,
      replyToMessageId: 2,
      text: 'Готовит голосовой ответ'
    });
    expect(db.getMessageByTelegramMessageId(1, 1001)).toMatchObject({
      text: 'да, звучит нормально',
      outputMode: 'voice'
    });
  });

  test('falls back to text when answer tts provider fails', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(createIncomingMessage({ messageId: 1 }));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1002,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult('коротко'))
      },
      replyDispatcher,
      textToSpeechProvider: {
        synthesize: vi.fn().mockRejectedValue(new Error('tts down'))
      },
      random: () => 0,
      initialChatTtsState: {
        answerLastOutputMode: 'text',
        answerEligibleTextSinceVoice: 3,
        answerEligibleTextStreak: 3,
        readLastVoiceAt: null
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 1,
        replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 1)
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'коротко'
    });
    expect(db.getMessageByTelegramMessageId(1, 1002)).toMatchObject({
      outputMode: 'text'
    });
  });

  test('does not send two voice replies in a row', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(createIncomingMessage({ messageId: 1 }));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1003,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const voiceDispatcher = vi.fn();
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult('коротко'))
      },
      replyDispatcher,
      textToSpeechProvider: {
        synthesize: vi.fn().mockResolvedValue({
          provider: 'yandex_speechkit',
          providerModel: 'speechkit-v1',
          audioBytes: new Uint8Array([1]),
          mimeType: 'audio/ogg'
        })
      },
      voiceDispatcher,
      random: () => 0,
      initialChatTtsState: {
        answerLastOutputMode: 'voice',
        answerEligibleTextSinceVoice: 0,
        answerEligibleTextStreak: 0,
        readLastVoiceAt: null
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 1,
        replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 1)
      })
    );

    expect(voiceDispatcher).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalled();
  });

  test('forces voice after pity gap', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(createIncomingMessage({ messageId: 1 }));
    const voiceDispatcher = vi.fn().mockResolvedValue({
      messageId: 1004,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult('коротко'))
      },
      replyDispatcher: vi.fn(),
      textToSpeechProvider: {
        synthesize: vi.fn().mockResolvedValue({
          provider: 'yandex_speechkit',
          providerModel: 'speechkit-v1',
          audioBytes: new Uint8Array([1]),
          mimeType: 'audio/ogg'
        })
      },
      voiceDispatcher,
      random: () => 0.99,
      initialChatTtsState: {
        answerLastOutputMode: 'text',
        answerEligibleTextSinceVoice: 12,
        answerEligibleTextStreak: 12,
        readLastVoiceAt: null
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 1,
        replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 1)
      })
    );

    expect(voiceDispatcher).toHaveBeenCalled();
  });

  test('skips dirty answer text and sends text', async () => {
    const db = new FakeDatabaseClient();
    db.saveIncomingMessage(createIncomingMessage({ messageId: 1 }));
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1005,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi
          .fn()
          .mockResolvedValue(createReplyResult('смотри https://example.com'))
      },
      replyDispatcher,
      textToSpeechProvider: {
        synthesize: vi.fn()
      },
      random: () => 0,
      initialChatTtsState: {
        answerLastOutputMode: 'text',
        answerEligibleTextSinceVoice: 3,
        answerEligibleTextStreak: 3,
        readLastVoiceAt: null
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToMessageId: 1,
        replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 1)
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'смотри https://example.com'
    });
  });

  test('sends local answer placeholders as text even when voice is eligible', async () => {
    const db = new FakeDatabaseClient();
    const synthesize = vi.fn().mockResolvedValue({
      provider: 'yandex_speechkit',
      providerModel: 'speechkit-v1',
      audioBytes: new Uint8Array([1]),
      mimeType: 'audio/ogg'
    });
    const voiceDispatcher = vi.fn();
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1006,
      createdAt: '2026-04-13T09:00:30.000Z'
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply: vi.fn().mockResolvedValue(createReplyResult('не надо'))
      },
      replyDispatcher,
      textToSpeechProvider: { synthesize },
      voiceDispatcher,
      random: () => 0,
      initialChatTtsState: {
        answerLastOutputMode: 'text',
        answerEligibleTextSinceVoice: 3,
        answerEligibleTextStreak: 3,
        readLastVoiceAt: null
      }
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: '/answer кто сильнее лев или тигр',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      })
    );

    expect(synthesize).not.toHaveBeenCalled();
    expect(voiceDispatcher).not.toHaveBeenCalled();
    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: 'Сделай reply на сообщение с вопросом и отправь /answer.'
    });
    expect(db.getMessageByTelegramMessageId(1, 1006)).toMatchObject({
      text: 'Сделай reply на сообщение с вопросом и отправь /answer.',
      outputMode: 'text'
    });
  });
});
