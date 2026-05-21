import { describe, expect, test, vi } from 'vitest';

import {
  botSendMessage,
  botSendPhoto,
  botSendVideo,
  botStart,
  botStop,
  chatOrchestratorConstructor,
  createEnv,
  dbCleanupExpiredData,
  dbClose,
  importCreateApplication,
  installAppTestHooks,
  maybeAnnounceDeployUpdate
} from './support.js';

describe('createApplication lifecycle', () => {
  installAppTestHooks();

  test('sends bot replies with Telegram HTML parse mode', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(createEnv());

    botSendMessage.mockResolvedValue({
      message_id: 44,
      date: 1_744_000_000
    });

    const orchestratorDeps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          replyDispatcher?: (input: {
            chatId: number;
            replyToMessageId: number;
            text: string;
          }) => Promise<{ messageId: number; createdAt: string }>;
        }
      | undefined;

    const sent = await orchestratorDeps?.replyDispatcher?.({
      chatId: -1001,
      replyToMessageId: 11,
      text: '<b>Коротко</b>'
    });

    expect(botSendMessage).toHaveBeenCalledWith(-1001, '<b>Коротко</b>', {
      parse_mode: 'HTML',
      reply_parameters: {
        message_id: 11
      }
    });
    expect(sent).toEqual({
      messageId: 44,
      createdAt: '2025-04-07T04:26:40.000Z'
    });
  });

  test('sends meme photos with Telegram HTML captions', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(createEnv());

    botSendPhoto.mockResolvedValue({
      message_id: 45,
      date: 1_744_000_001
    });

    const orchestratorDeps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          memeDispatcher?: (input: {
            chatId: number;
            replyToMessageId: number;
            caption: string;
            media: {
              kind: 'image';
              filePath: string;
              extension: string;
              cleanup: () => Promise<void>;
            };
          }) => Promise<{ messageId: number; createdAt: string }>;
        }
      | undefined;

    const sent = await orchestratorDeps?.memeDispatcher?.({
      chatId: -1001,
      replyToMessageId: 11,
      caption: '<b>Мем</b>',
      media: {
        kind: 'image',
        filePath: '/tmp/meme.jpg',
        extension: 'jpg',
        cleanup: vi.fn()
      }
    });

    expect(botSendPhoto).toHaveBeenCalledWith(
      -1001,
      expect.objectContaining({ source: '/tmp/meme.jpg' }),
      {
        caption: '<b>Мем</b>',
        parse_mode: 'HTML',
        link_preview_options: {
          is_disabled: true
        },
        reply_parameters: {
          message_id: 11
        }
      }
    );
    expect(sent).toEqual({
      messageId: 45,
      createdAt: '2025-04-07T04:26:41.000Z'
    });
  });

  test('sends meme videos with Telegram HTML captions', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(createEnv());

    botSendVideo.mockResolvedValue({
      message_id: 46,
      date: 1_744_000_002,
      video: {
        file_id: 'video-file',
        file_unique_id: 'video-unique',
        mime_type: 'video/mp4',
        file_size: 123,
        duration: 7
      }
    });

    const orchestratorDeps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          memeDispatcher?: (input: {
            chatId: number;
            replyToMessageId: number;
            caption: string;
            media: {
              kind: 'video';
              filePath: string;
            };
          }) => Promise<{ messageId: number; createdAt: string }>;
        }
      | undefined;

    const sent = await orchestratorDeps?.memeDispatcher?.({
      chatId: -1001,
      replyToMessageId: 11,
      caption: '<b>Видео</b>',
      media: {
        kind: 'video',
        filePath: '/tmp/meme.mp4'
      }
    });

    expect(botSendVideo).toHaveBeenCalledWith(
      -1001,
      expect.objectContaining({ source: '/tmp/meme.mp4' }),
      {
        caption: '<b>Видео</b>',
        parse_mode: 'HTML',
        link_preview_options: {
          is_disabled: true
        },
        reply_parameters: {
          message_id: 11
        }
      }
    );
    expect(sent).toEqual({
      messageId: 46,
      createdAt: '2025-04-07T04:26:42.000Z',
      mediaSnapshot: {
        messageId: 46,
        mediaKind: 'video',
        fileId: 'video-file',
        fileUniqueId: 'video-unique',
        mimeType: 'video/mp4',
        fileSize: 123,
        durationSeconds: 7,
        caption: '<b>Видео</b>'
      }
    });
  });

  test('sends meme media with Telegram spoiler flag', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(createEnv());

    botSendPhoto.mockResolvedValue({
      message_id: 47,
      date: 1_744_000_003
    });

    const orchestratorDeps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          memeDispatcher?: (input: {
            chatId: number;
            caption: string;
            hasSpoiler: boolean;
            media: {
              kind: 'image';
              filePath: string;
            };
          }) => Promise<{ messageId: number; createdAt: string }>;
        }
      | undefined;

    await orchestratorDeps?.memeDispatcher?.({
      chatId: -1001,
      caption: '<b>Мем</b>',
      hasSpoiler: true,
      media: {
        kind: 'image',
        filePath: '/tmp/meme.jpg'
      }
    });

    expect(botSendPhoto).toHaveBeenCalledWith(
      -1001,
      expect.objectContaining({ source: '/tmp/meme.jpg' }),
      expect.objectContaining({
        has_spoiler: true
      })
    );
  });

  test('announces deploy updates before polling starts', async () => {
    const { createApplication } = await importCreateApplication();
    const app = await createApplication(createEnv());

    await app.start();

    expect(maybeAnnounceDeployUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramChatId: -1002155313986,
        db: expect.any(Object),
        llm: expect.any(Object),
        sendMessage: expect.any(Function),
        logger: expect.any(Object),
        now: expect.any(Function)
      })
    );
    expect(botStart).toHaveBeenCalledWith({
      allowed_updates: ['message', 'edited_message']
    });
  });

  test('uses an admin-notifying logger for downstream components', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(createEnv({ telegramAdminId: 42 }));

    const orchestratorDeps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          logger?: {
            warn(event: string): void;
          };
        }
      | undefined;

    orchestratorDeps?.logger?.warn('downstream_warning');
    await Promise.resolve();

    expect(botSendMessage).toHaveBeenCalledWith(
      42,
      'WARN: downstream_warning',
      {
        parse_mode: 'HTML'
      }
    );
  });

  test('stops bot and closes database without summary timers', async () => {
    const { createApplication } = await importCreateApplication();
    const app = await createApplication(createEnv());

    await app.stop();

    expect(botStop).toHaveBeenCalled();
    expect(dbClose).toHaveBeenCalled();
  });

  test('runs database cleanup on start and clears timer on stop', async () => {
    vi.useFakeTimers();
    const { createApplication } = await importCreateApplication();
    const app = await createApplication(
      createEnv({
        databaseCleanupIntervalHours: 2,
        messageRetentionDays: 3,
        mediaArtifactRetentionDays: 5
      })
    );

    await app.start();

    expect(dbCleanupExpiredData).toHaveBeenCalledWith({
      now: expect.any(String),
      messageRetentionDays: 3,
      mediaArtifactRetentionDays: 5,
      memeHistoryRetentionDays: 14,
      legacyNewsPostRetentionDays: 7
    });

    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(dbCleanupExpiredData).toHaveBeenCalledTimes(2);

    await app.stop();
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(dbCleanupExpiredData).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
