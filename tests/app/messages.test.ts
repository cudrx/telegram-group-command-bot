import { describe, expect, test } from 'vitest';

import {
  botState,
  createEnv,
  handleIncomingMessage,
  importCreateApplication,
  installAppTestHooks
} from './support.js';

describe('createApplication message forwarding', () => {
  installAppTestHooks();

  function createAllowedAppEnv() {
    return createEnv({ telegramChatId: -1001, telegramAdminId: 84626969 });
  }

  test('forwards text messages from other bots so answer replies can use them as anchors', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(createAllowedAppEnv());

    await botState.messageHandler?.({
      message: {
        message_id: 12,
        date: 1_744_000_000,
        text: 'кто сильнее лев или тигр?',
        from: {
          id: 555,
          is_bot: true,
          username: 'rofl_bot',
          first_name: 'Rofl Bot'
        },
        chat: {
          id: -1001,
          type: 'supergroup',
          title: 'Test chat'
        }
      }
    });

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -1001,
        messageId: 12,
        text: 'кто сильнее лев или тигр?',
        isBot: true,
        fromUserId: 555
      })
    );
  });

  test('forwards replied-to text snapshots for answer fallback anchors', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(createAllowedAppEnv());

    await botState.messageHandler?.({
      message: {
        message_id: 13,
        date: 1_744_000_030,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        from: {
          id: 123,
          is_bot: false,
          username: 'artyom',
          first_name: 'Artyom'
        },
        chat: {
          id: -1001,
          type: 'supergroup',
          title: 'Test chat'
        },
        reply_to_message: {
          message_id: 12,
          date: 1_744_000_000,
          text: 'кто сильнее лев или тигр?',
          from: {
            id: 555,
            is_bot: true,
            username: 'rofl_bot',
            first_name: 'Rofl Bot'
          },
          chat: {
            id: -1001,
            type: 'supergroup',
            title: 'Test chat'
          }
        }
      }
    });

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 13,
        replyToMessageId: 12,
        replyToMessageSnapshot: expect.objectContaining({
          messageId: 12,
          userId: 555,
          isBot: true,
          text: 'кто сильнее лев или тигр?'
        })
      })
    );
  });

  test('forwards media captions as message text', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(createAllowedAppEnv());

    await botState.messageHandler?.({
      message: {
        message_id: 14,
        date: 1_744_000_040,
        video: {
          file_id: 'video-file',
          file_unique_id: 'video-unique',
          duration: 14,
          width: 720,
          height: 1280
        },
        caption: 'POV: Трамп объявляет, что он открыл пролив.',
        caption_entities: [{ type: 'bold', offset: 0, length: 3 }],
        from: {
          id: 123,
          is_bot: false,
          username: 'artyom',
          first_name: 'Artyom'
        },
        chat: {
          id: -1001,
          type: 'supergroup',
          title: 'Test chat'
        }
      }
    });

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -1001,
        messageId: 14,
        text: 'POV: Трамп объявляет, что он открыл пролив.',
        entities: [{ type: 'bold', offset: 0, length: 3 }]
      })
    );
  });

  test('forwards replied-to media captions for answer fallback anchors', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(createAllowedAppEnv());

    await botState.messageHandler?.({
      message: {
        message_id: 15,
        date: 1_744_000_050,
        text: '/answer',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        from: {
          id: 123,
          is_bot: false,
          username: 'artyom',
          first_name: 'Artyom'
        },
        chat: {
          id: -1001,
          type: 'supergroup',
          title: 'Test chat'
        },
        reply_to_message: {
          message_id: 14,
          date: 1_744_000_040,
          video: {
            file_id: 'video-file',
            file_unique_id: 'video-unique',
            duration: 14,
            width: 720,
            height: 1280
          },
          caption: 'POV: Трамп объявляет, что он открыл пролив.',
          from: {
            id: 124,
            is_bot: false,
            username: 'artur',
            first_name: 'Artur'
          },
          chat: {
            id: -1001,
            type: 'supergroup',
            title: 'Test chat'
          }
        }
      }
    });

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 15,
        replyToMessageId: 14,
        replyToMessageSnapshot: expect.objectContaining({
          messageId: 14,
          userId: 124,
          isBot: false,
          text: 'POV: Трамп объявляет, что он открыл пролив.'
        })
      })
    );
  });
});
