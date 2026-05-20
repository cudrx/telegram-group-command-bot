import { describe, expect, test } from 'vitest';

import {
  botCopyMessage,
  botCopyMessages,
  botDeleteMessage,
  botGetMe,
  botSendChatAction,
  botSendVoice,
  botStart,
  botState,
  chatOrchestratorConstructor,
  createEnv,
  dbUpdateIncomingMessageEdit,
  handleIncomingMessage,
  importCreateApplication,
  installAppTestHooks,
  llmConstructor,
  yandexSpeechKitConstructor
} from './support.js';

describe('createApplication wiring', () => {
  installAppTestHooks();

  test('wires v0 reply-only dependencies and forwards text messages', async () => {
    const { createApplication } = await importCreateApplication();
    const app = await createApplication(
      createEnv({ telegramChatId: -1001, telegramAdminId: 84626969 })
    );

    expect(llmConstructor).toHaveBeenCalledWith(
      {
        apiKey: 'llm-key',
        baseUrl: 'https://example.com',
        replyModel: 'reply-model',
        replyTemperature: 0.6,
        plannerModel: 'planner-model',
        lookupMaxQueries: 1,
        timeoutMs: 20_000,
        maxRetries: 1
      },
      undefined,
      expect.any(Object)
    );

    const orchestratorDeps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          sendChatAction?: (
            chatId: number,
            action: 'typing' | 'record_voice'
          ) => Promise<void>;
        }
      | undefined;

    await orchestratorDeps?.sendChatAction?.(-1001, 'record_voice');
    expect(botSendChatAction).toHaveBeenCalledWith(-1001, 'record_voice');

    await app.start();

    expect(botStart).toHaveBeenCalledWith({
      allowed_updates: ['message', 'edited_message']
    });

    await botState.messageHandler?.({
      message: {
        message_id: 11,
        date: 1_744_000_000,
        text: '@hrupa_bot привет',
        entities: [{ type: 'mention', offset: 0, length: 10 }],
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
        messageId: 11,
        text: '@hrupa_bot привет',
        authorizedMode: 'chat'
      })
    );
  });

  test('updates existing incoming messages on Telegram edits without invoking orchestrator', async () => {
    const { createApplication } = await importCreateApplication();
    const app = await createApplication(
      createEnv({ telegramChatId: -1001, telegramAdminId: 84626969 })
    );

    await app.start();

    dbUpdateIncomingMessageEdit.mockReturnValue(true);

    await botState.editedMessageHandler?.({
      update: {
        edited_message: {
          message_id: 11,
          date: 1_744_000_000,
          edit_date: 1_744_000_060,
          text: '@hrupa_bot исправленный текст',
          entities: [{ type: 'mention', offset: 0, length: 10 }],
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
      }
    });

    expect(dbUpdateIncomingMessageEdit).toHaveBeenCalledWith({
      chatId: -1001,
      messageId: 11,
      text: '@hrupa_bot исправленный текст',
      editedAt: '2025-04-07T04:27:40.000Z'
    });
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  test('wires outbound tts provider and voice dispatcher when yandex env is present', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(
      createEnv({
        telegramChatId: -1001,
        telegramAdminId: 84626969,
        yandexSpeechKitApiKey: 'yandex-key'
      })
    );

    expect(yandexSpeechKitConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'yandex-key'
      })
    );

    const deps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          voiceDispatcher?: (input: {
            chatId: number;
            replyToMessageId: number;
            audioBytes: Uint8Array;
            filename: string;
            mimeType: 'audio/ogg';
          }) => Promise<{ messageId: number; createdAt: string }>;
        }
      | undefined;

    botSendVoice.mockResolvedValue({
      message_id: 99,
      date: 1_744_000_100
    });

    await deps?.voiceDispatcher?.({
      chatId: -1001,
      replyToMessageId: 11,
      audioBytes: new Uint8Array([1, 2, 3]),
      filename: 'reply.ogg',
      mimeType: 'audio/ogg'
    });

    expect(botSendVoice).toHaveBeenCalledWith(
      -1001,
      expect.anything(),
      expect.objectContaining({
        reply_parameters: { message_id: 11 }
      })
    );
  });

  test('wires publish copy dispatchers to Telegram copy APIs', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(
      createEnv({ telegramChatId: -1001, telegramAdminId: 84626969 })
    );

    const deps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          copyMessageDispatcher?: (input: {
            targetChatId: number;
            sourceChatId: number;
            messageId: number;
          }) => Promise<{ messageId: number; createdAt: string }>;
          copyMessagesDispatcher?: (input: {
            targetChatId: number;
            sourceChatId: number;
            messageIds: number[];
          }) => Promise<Array<{ messageId: number; createdAt: string }>>;
        }
      | undefined;

    botCopyMessage.mockResolvedValue({
      message_id: 99,
      date: 1_744_000_100
    });
    botCopyMessages.mockResolvedValue([
      { message_id: 100 },
      { message_id: 101 }
    ]);

    await deps?.copyMessageDispatcher?.({
      targetChatId: -1001,
      sourceChatId: 84626969,
      messageId: 11
    });
    await deps?.copyMessagesDispatcher?.({
      targetChatId: -1001,
      sourceChatId: 84626969,
      messageIds: [11, 12]
    });

    expect(botCopyMessage).toHaveBeenCalledWith(-1001, 84626969, 11);
    expect(botCopyMessages).toHaveBeenCalledWith(-1001, 84626969, [11, 12]);
  });

  test('wires source message deletion to Telegram deleteMessage API', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(
      createEnv({ telegramChatId: -1001, telegramAdminId: 84626969 })
    );

    const deps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          deleteMessageDispatcher?: (input: {
            chatId: number;
            messageId: number;
          }) => Promise<void>;
        }
      | undefined;

    await deps?.deleteMessageDispatcher?.({
      chatId: -1001,
      messageId: 11
    });

    expect(botDeleteMessage).toHaveBeenCalledWith(-1001, 11);
  });

  test('drops messages from unauthorized chats before the orchestrator', async () => {
    const { createApplication } = await importCreateApplication();
    const app = await createApplication(
      createEnv({ telegramChatId: -1001, telegramAdminId: 84626969 })
    );

    await app.start();

    await botState.messageHandler?.({
      message: {
        message_id: 12,
        date: 1_744_000_000,
        text: '/summarize',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }],
        from: {
          id: 123,
          is_bot: false,
          username: 'artyom',
          first_name: 'Artyom'
        },
        chat: {
          id: -2002,
          type: 'supergroup',
          title: 'Other chat'
        }
      }
    });

    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  test('forwards private messages from the configured admin only', async () => {
    botGetMe.mockResolvedValue({
      id: 77,
      username: 'hrupa_bot',
      first_name: 'Assistant'
    });
    const { createApplication } = await importCreateApplication();
    const app = await createApplication(
      createEnv({ telegramChatId: -1001, telegramAdminId: 84626969 })
    );

    await app.start();

    await botState.messageHandler?.({
      message: {
        message_id: 13,
        date: 1_744_000_000,
        text: '/summarize',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }],
        from: {
          id: 84626969,
          is_bot: false,
          username: 'artyom',
          first_name: 'Artyom'
        },
        chat: {
          id: 84626969,
          type: 'private'
        }
      }
    });

    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 84626969,
        authorizedMode: 'private_admin'
      })
    );
  });

  test('drops private messages from non-admin users before the orchestrator', async () => {
    const { createApplication } = await importCreateApplication();
    const app = await createApplication(
      createEnv({ telegramChatId: -1001, telegramAdminId: 84626969 })
    );

    await app.start();

    await botState.messageHandler?.({
      message: {
        message_id: 14,
        date: 1_744_000_000,
        text: '/summarize',
        entities: [{ type: 'bot_command', offset: 0, length: 10 }],
        from: {
          id: 555,
          is_bot: false,
          username: 'stranger',
          first_name: 'Stranger'
        },
        chat: {
          id: 555,
          type: 'private'
        }
      }
    });

    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });
});
