import { describe, expect, test } from 'vitest';

import {
  botGetMe,
  botSendChatAction,
  botStart,
  botState,
  chatOrchestratorConstructor,
  createEnv,
  handleIncomingMessage,
  importCreateApplication,
  installAppTestHooks,
  llmConstructor
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
          sendTyping?: (chatId: number) => Promise<void>;
        }
      | undefined;

    await orchestratorDeps?.sendTyping?.(-1001);
    expect(botSendChatAction).toHaveBeenCalledWith(-1001, 'typing');

    await app.start();

    expect(botStart).toHaveBeenCalledWith({
      allowed_updates: ['message']
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
