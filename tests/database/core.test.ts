import { describe, expect, test } from 'vitest';

import { DatabaseClient } from '../../src/database/index.js';
import { normalizeTextMessage } from '../../src/transport/telegram/normalize-message.js';
import {
  canUseBetterSqlite,
  createDatabase,
  createIncomingMessage
} from './support.js';

const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

describeWithSqlite('DatabaseClient core', () => {
  test('persists reply_to_message_id on incoming and bot messages', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(createIncomingMessage({ messageId: 10 }));
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 11,
        text: 'ответ на первое',
        fromUserId: 99,
        fromUsername: 'oleg',
        fromDisplayName: 'Олег (@oleg)',
        replyToUserId: 42,
        replyToMessageId: 10
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: 'Friends',
      messageId: 12,
      text: 'бот ответил',
      createdAt: '2026-04-10T12:00:20.000Z',
      userId: 77,
      username: 'fun_bot',
      displayName: 'Fun Bot',
      replyToMessageId: 11
    });

    expect(db.getMessageByTelegramMessageId(1, 11)).toMatchObject({
      messageId: 11,
      replyToMessageId: 10
    });
    expect(db.getMessageByTelegramMessageId(1, 12)).toMatchObject({
      messageId: 12,
      replyToMessageId: 11
    });

    db.close();
  });

  test('stores bot output mode and defaults incoming messages to text', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(createIncomingMessage({ messageId: 10 }));
    db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: 'Friends',
      messageId: 11,
      text: 'бот сказал голосом',
      createdAt: '2026-04-10T12:00:20.000Z',
      userId: 77,
      username: 'fun_bot',
      displayName: 'Fun Bot',
      replyToMessageId: 10,
      outputMode: 'voice'
    });

    expect(db.getMessageByTelegramMessageId(1, 10)).toMatchObject({
      outputMode: 'text'
    });
    expect(db.getMessageByTelegramMessageId(1, 11)).toMatchObject({
      text: 'бот сказал голосом',
      outputMode: 'voice'
    });

    db.close();
  });

  test('stores per-chat outbound tts state', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(createIncomingMessage({ messageId: 10 }));
    db.updateChatTtsState({
      chatId: 1,
      answerLastOutputMode: 'voice',
      answerEligibleTextSinceVoice: 0,
      answerEligibleTextStreak: 0,
      readLastVoiceAt: '2026-04-10T12:00:20.000Z'
    });

    expect(db.getChatState(1)).toMatchObject({
      answerLastOutputMode: 'voice',
      answerEligibleTextSinceVoice: 0,
      answerEligibleTextStreak: 0,
      readLastVoiceAt: '2026-04-10T12:00:20.000Z'
    });

    db.updateChatTtsState({
      chatId: 1,
      answerLastOutputMode: null,
      readLastVoiceAt: null
    });

    expect(db.getChatState(1)).toMatchObject({
      answerLastOutputMode: null,
      answerEligibleTextSinceVoice: 0,
      answerEligibleTextStreak: 0,
      readLastVoiceAt: null
    });

    db.close();
  });

  test('normalizes explicit reply links from Telegram messages', () => {
    const ctx = {
      message: {
        message_id: 346,
        date: 1_744_300_000,
        text: 'ответ',
        entities: [],
        reply_to_message: {
          message_id: 345,
          from: { id: 77, is_bot: false }
        },
        from: { id: 99, is_bot: false, first_name: 'Олег' },
        chat: { id: 1, type: 'group' }
      }
    } as never;

    expect(normalizeTextMessage(ctx)).toMatchObject({
      replyToUserId: 77,
      replyToMessageId: 345
    });
  });

  test('normalizes media-only messages with own media snapshot', () => {
    const ctx = {
      message: {
        message_id: 346,
        date: 1_744_300_000,
        photo: [
          {
            file_id: 'small-photo',
            file_unique_id: 'small-unique',
            file_size: 100
          },
          {
            file_id: 'large-photo',
            file_unique_id: 'large-unique',
            file_size: 500
          }
        ],
        from: { id: 99, is_bot: false, first_name: 'Олег' },
        chat: { id: 1, type: 'group' }
      }
    } as never;

    expect(normalizeTextMessage(ctx)).toMatchObject({
      text: '',
      mediaSnapshot: {
        messageId: 346,
        mediaKind: 'photo',
        fileId: 'large-photo',
        fileUniqueId: 'large-unique'
      }
    });
  });

  test('schema keeps messages and chats only, with sender and media metadata on messages', () => {
    const db = createDatabase();

    expect(db.getSchemaColumns('chats')).toEqual([
      'chat_id',
      'chat_type',
      'title',
      'last_message_at',
      'last_bot_message_at',
      'answer_last_output_mode',
      'answer_eligible_text_since_voice',
      'answer_eligible_text_streak',
      'read_last_voice_at'
    ]);
    expect(db.getSchemaColumns('participants')).toEqual([]);
    expect(db.getSchemaColumns('chat_participants')).toEqual([]);
    expect(db.getSchemaColumns('messages')).toEqual([
      'id',
      'chat_id',
      'telegram_message_id',
      'user_id',
      'sender_display_name',
      'text',
      'created_at',
      'is_bot',
      'reply_to_telegram_message_id',
      'media_kind',
      'media_file_id',
      'media_file_unique_id',
      'media_mime_type',
      'media_file_size',
      'media_duration_seconds',
      'media_caption',
      'media_group_id',
      'from_user_id',
      'from_username',
      'from_first_name',
      'from_last_name',
      'from_display_name',
      'output_mode'
    ]);

    db.close();
  });

  test('stores sender metadata directly on message rows', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        fromUserId: 42,
        fromUsername: 'tom',
        fromFirstName: 'Tom',
        fromLastName: 'Ivanov',
        fromDisplayName: 'Tom Ivanov (@tom)'
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: 'Friends',
      messageId: 11,
      text: 'бот ответил',
      createdAt: '2026-04-10T12:00:20.000Z',
      userId: 77,
      username: 'fun_bot',
      displayName: 'Fun Bot',
      replyToMessageId: 10
    });

    expect(db.getMessageByTelegramMessageId(1, 10)).toMatchObject({
      userId: 42,
      senderDisplayName: 'Tom Ivanov (@tom)',
      replyToMessageId: null
    });
    expect(db.getMessageByTelegramMessageId(1, 11)).toMatchObject({
      userId: 77,
      senderDisplayName: 'Fun Bot',
      replyToMessageId: 10
    });

    db.close();
  });

  test('stores and reads media snapshot metadata on message rows', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        text: '',
        mediaSnapshot: {
          messageId: 10,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: 'image/jpeg',
          fileSize: 500,
          durationSeconds: null,
          caption: 'подпись'
        }
      })
    );

    expect(db.getMessageByTelegramMessageId(1, 10)).toMatchObject({
      messageId: 10,
      mediaSnapshot: expect.objectContaining({
        mediaKind: 'photo',
        fileId: 'photo-file',
        fileUniqueId: 'photo-unique'
      })
    });

    db.close();
  });

  test('stores media group id for incoming messages and null for bot messages', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        mediaGroupId: 'album-1'
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: 'group',
      chatTitle: 'Friends',
      messageId: 11,
      text: 'бот ответил',
      createdAt: '2026-04-10T12:00:20.000Z',
      userId: 77,
      username: 'fun_bot',
      displayName: 'Fun Bot',
      replyToMessageId: 10
    });

    expect(db.getMessageByTelegramMessageId(1, 10)).toMatchObject({
      messageId: 10,
      mediaGroupId: 'album-1'
    });
    expect(db.getMessageByTelegramMessageId(1, 11)).toMatchObject({
      messageId: 11,
      mediaGroupId: null
    });

    db.close();
  });

  test('stores app state key values', () => {
    const db = DatabaseClient.open(':memory:');

    expect(db.getAppState('last_announced_deploy_sha')).toBe(null);
    db.setAppState(
      'last_announced_deploy_sha',
      'abc123',
      '2026-04-19T10:00:00.000Z'
    );
    expect(db.getAppState('last_announced_deploy_sha')).toBe('abc123');

    db.setAppState(
      'last_announced_deploy_sha',
      'def456',
      '2026-04-19T10:05:00.000Z'
    );
    expect(db.getAppState('last_announced_deploy_sha')).toBe('def456');

    db.close();
  });
});
