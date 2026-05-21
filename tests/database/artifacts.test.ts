import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { cleanupExpiredData } from '../../src/database/artifacts-cleanup.js';
import { DatabaseClient } from '../../src/database/index.js';
import { canUseBetterSqlite, createIncomingMessage } from './support.js';

const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

describeWithSqlite('DatabaseClient artifacts', () => {
  test('creates the media artifact schema and indexes', () => {
    const db = DatabaseClient.open(':memory:');

    expect(db.getSchemaColumns('media_artifacts')).toEqual([
      'id',
      'file_unique_id',
      'chat_id',
      'telegram_message_id',
      'media_kind',
      'provider',
      'provider_model',
      'artifact_kind',
      'artifact_status',
      'artifact_text',
      'artifact_json',
      'raw_response_json',
      'source_caption',
      'source_mime_type',
      'source_file_size',
      'source_duration_seconds',
      'recognition_language',
      'confidence_json',
      'error_text',
      'created_at',
      'expires_at'
    ]);

    expect(db.getIndexNames('media_artifacts').sort()).toEqual(
      [
        'idx_media_artifacts_expires_at',
        'idx_media_artifacts_file_unique_provider',
        'idx_media_artifacts_message_provider'
      ].sort()
    );
    expect(db.getSchemaColumns('news_posts')).toEqual([]);

    db.close();
  });

  test('skips legacy news cleanup when the removed news table is absent', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE chats (
        chat_id INTEGER PRIMARY KEY
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE media_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE meme_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        sent_at TEXT NOT NULL
      );
    `);

    expect(
      cleanupExpiredData(db, {
        now: '2026-05-21T10:00:00.000Z',
        messageRetentionDays: 30,
        mediaArtifactRetentionDays: 7,
        memeHistoryRetentionDays: 14
      })
    ).toMatchObject({ newsPosts: 0 });

    db.close();
  });

  test('stores and reads cached media artifacts with file_unique_id preference', () => {
    const db = DatabaseClient.open(':memory:');
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatTitle: 'Cache chat',
        messageId: 20,
        createdAt: '2026-04-21T09:59:00.000Z'
      })
    );
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatTitle: 'Cache chat',
        messageId: 21,
        createdAt: '2026-04-21T09:58:00.000Z'
      })
    );

    db.saveMediaArtifact({
      fileUniqueId: null,
      chatId: 1,
      telegramMessageId: 21,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: 'from-message-fallback',
      artifactJson: { type: 'transcript', transcript: 'from-message-fallback' },
      rawResponseJson: { status: 'done' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 123,
      sourceDurationSeconds: 3,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-21T09:59:00.000Z',
      expiresAt: '2026-04-28T09:59:00.000Z'
    });

    db.saveMediaArtifact({
      fileUniqueId: 'telegram-file-unique',
      chatId: 1,
      telegramMessageId: 20,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: 'привет',
      artifactJson: {
        type: 'transcript',
        transcript: 'привет',
        language: null,
        duration: 3
      },
      rawResponseJson: { status: 'done' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 123,
      sourceDurationSeconds: 3,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-21T10:00:00.000Z',
      expiresAt: '2026-04-28T10:00:00.000Z'
    });

    expect(
      db.getSuccessfulMediaArtifact({
        fileUniqueId: 'telegram-file-unique',
        chatId: 1,
        telegramMessageId: 20,
        provider: 'gladia',
        artifactKind: 'transcript'
      })
    ).toMatchObject({
      fileUniqueId: 'telegram-file-unique',
      artifactText: 'привет'
    });

    expect(
      db.getSuccessfulMediaArtifact({
        fileUniqueId: null,
        chatId: 1,
        telegramMessageId: 21,
        provider: 'gladia',
        artifactKind: 'transcript'
      })
    ).toMatchObject({
      fileUniqueId: null,
      artifactText: 'from-message-fallback'
    });

    db.close();
  });

  test('does not return failed media artifacts from the cache', () => {
    const db = DatabaseClient.open(':memory:');
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatTitle: 'Cache chat',
        messageId: 20,
        createdAt: '2026-04-21T10:00:00.000Z'
      })
    );

    db.saveMediaArtifact({
      fileUniqueId: 'telegram-file-unique',
      chatId: 1,
      telegramMessageId: 20,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'failed',
      artifactText: null,
      artifactJson: null,
      rawResponseJson: { status: 'error' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 123,
      sourceDurationSeconds: 3,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: 'provider failed',
      createdAt: '2026-04-21T10:00:00.000Z',
      expiresAt: '2026-04-28T10:00:00.000Z'
    });

    expect(
      db.getSuccessfulMediaArtifact({
        fileUniqueId: 'telegram-file-unique',
        chatId: 1,
        telegramMessageId: 20,
        provider: 'gladia',
        artifactKind: 'transcript'
      })
    ).toBe(null);

    db.close();
  });

  test('returns latest media artifact regardless of status (including partial markers)', () => {
    const db = DatabaseClient.open(':memory:');
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatTitle: 'Cache chat',
        messageId: 20,
        createdAt: '2026-04-21T10:00:00.000Z'
      })
    );

    db.saveMediaArtifact({
      fileUniqueId: 'telegram-file-unique',
      chatId: 1,
      telegramMessageId: 20,
      mediaKind: 'photo',
      provider: 'ocr_space',
      providerModel: 'ocr-model',
      artifactKind: 'ocr_text_default',
      artifactStatus: 'success',
      artifactText: 'hello',
      artifactJson: { text: 'hello' },
      rawResponseJson: { status: 'ok', language: null },
      sourceCaption: null,
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 123,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-21T10:00:01.000Z',
      expiresAt: '2026-04-28T10:00:01.000Z'
    });

    db.saveMediaArtifact({
      fileUniqueId: 'telegram-file-unique',
      chatId: 1,
      telegramMessageId: 20,
      mediaKind: 'photo',
      provider: 'ocr_space',
      providerModel: 'ocr-model',
      artifactKind: 'ocr_text_default',
      artifactStatus: 'partial',
      artifactText: null,
      artifactJson: { text: null, reason: 'empty_result' },
      rawResponseJson: { status: 'ok', language: null },
      sourceCaption: null,
      sourceMimeType: 'image/jpeg',
      sourceFileSize: 123,
      sourceDurationSeconds: null,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: 'empty_result',
      createdAt: '2026-04-21T10:00:02.000Z',
      expiresAt: '2026-04-28T10:00:02.000Z'
    });

    expect(
      db.getLatestMediaArtifact({
        fileUniqueId: 'telegram-file-unique',
        chatId: 1,
        telegramMessageId: 20,
        provider: 'ocr_space',
        artifactKind: 'ocr_text_default'
      })
    ).toMatchObject({
      artifactStatus: 'partial',
      errorText: 'empty_result'
    });

    db.close();
  });

  test('cleans up expired media artifacts, old messages, and empty chats', () => {
    const db = DatabaseClient.open(':memory:');
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatTitle: 'Old chat',
        messageId: 10,
        createdAt: '2026-04-10T00:00:00.000Z'
      })
    );
    db.saveMediaArtifact({
      fileUniqueId: 'old-file-unique',
      chatId: 1,
      telegramMessageId: 10,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: 'old transcript',
      artifactJson: { transcript: 'old transcript' },
      rawResponseJson: { status: 'done' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 123,
      sourceDurationSeconds: 3,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-10T00:00:00.000Z',
      expiresAt: '2026-04-11T00:00:00.000Z'
    });

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 2,
        chatTitle: 'Recent chat',
        messageId: 20,
        createdAt: '2026-04-26T00:00:00.000Z'
      })
    );
    db.saveMediaArtifact({
      fileUniqueId: 'recent-file-unique',
      chatId: 2,
      telegramMessageId: 20,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: 'recent transcript',
      artifactJson: { transcript: 'recent transcript' },
      rawResponseJson: { status: 'done' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 456,
      sourceDurationSeconds: 4,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-26T00:00:00.000Z',
      expiresAt: '2026-05-03T00:00:00.000Z'
    });

    expect(
      db.cleanupExpiredData({
        now: '2026-04-29T00:00:00.000Z',
        messageRetentionDays: 7,
        mediaArtifactRetentionDays: 7,
        memeHistoryRetentionDays: 14
      })
    ).toEqual({
      mediaArtifacts: 1,
      messages: 1,
      chats: 1,
      memePosts: 0,
      newsPosts: 0
    });

    db.close();
  });

  test('keeps chats with retained media artifacts after old messages are cleaned', () => {
    const db = DatabaseClient.open(':memory:');
    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        chatTitle: 'Artifact chat',
        messageId: 10,
        createdAt: '2026-04-10T00:00:00.000Z'
      })
    );
    db.saveMediaArtifact({
      fileUniqueId: 'retained-file-unique',
      chatId: 1,
      telegramMessageId: 10,
      mediaKind: 'voice',
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: 'retained transcript',
      artifactJson: { transcript: 'retained transcript' },
      rawResponseJson: { status: 'done' },
      sourceCaption: null,
      sourceMimeType: 'audio/ogg',
      sourceFileSize: 123,
      sourceDurationSeconds: 3,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: null,
      createdAt: '2026-04-20T00:00:00.000Z',
      expiresAt: '2026-05-20T00:00:00.000Z'
    });

    expect(
      db.cleanupExpiredData({
        now: '2026-04-29T00:00:00.000Z',
        messageRetentionDays: 7,
        mediaArtifactRetentionDays: 30,
        memeHistoryRetentionDays: 14
      })
    ).toEqual({
      mediaArtifacts: 0,
      messages: 1,
      chats: 0,
      memePosts: 0,
      newsPosts: 0
    });

    db.close();
  });
});
