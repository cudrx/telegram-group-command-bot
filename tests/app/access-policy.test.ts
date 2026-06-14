import { describe, expect, test } from 'vitest';

import { resolveAccessContext } from '../../src/app/access-policy.js';
import { ChatOrchestrator } from '../../src/app/chat-orchestrator/index.js';
import type { AppEnv } from '../../src/config/env/index.js';
import type { ChatPolicy } from '../../src/config/env/types.js';
import { createTestChatPolicy } from '../helpers/telegram-fixtures.js';

function createChatPolicy(
  overrides: Omit<Partial<ChatPolicy>, 'commands' | 'features'> & {
    commands?: Partial<ChatPolicy['commands']>;
    features?: Partial<ChatPolicy['features']>;
  } = {}
): ChatPolicy {
  return createTestChatPolicy({
    chatId: -1001,
    label: 'main',
    ...overrides
  });
}

function createEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    nodeEnv: 'test',
    telegramBotToken: 'telegram-token',
    llmApiKey: 'llm-key',
    llmBaseUrl: 'https://example.com',
    llmReplyModel: 'reply-model',
    llmPlannerModel: 'planner-model',
    llmReplyTemperature: 0.6,
    llmTimeoutMs: 20_000,
    llmMaxRetries: 1,
    logLlmText: false,
    logLevel: 'info',
    logColor: true,
    sqlitePath: ':memory:',
    redditCookieHeaderPath: null,
    redditCookiesPath: null,
    instagramCookiesPath: null,
    youtubeCookiesPath: null,
    answerContextLimit: 50,
    summarizeContextLimit: 200,
    decideContextLimit: 100,
    replyMinTypingMs: 0,
    replyMaxTypingMs: 0,
    replyTypingRefreshMs: 4000,
    lookupProvider: 'tavily',
    tavilyApiKey: null,
    lookupTimeoutMs: 7000,
    lookupMaxQueries: 1,
    lookupMaxResults: 3,
    ocrSpaceApiKey: null,
    sttProvider: 'gladia',
    gladiaApiKey: null,
    yandexSpeechKitApiKey: null,
    visionProvider: 'cloudflare',
    cloudflareAiApiKey: null,
    cloudflareAccountId: null,
    mediaMaxFileBytes: 10_000_000,
    mediaArtifactRetentionDays: 7,
    memeHistoryRetentionDays: 14,
    messageRetentionDays: 7,
    databaseCleanupIntervalHours: 24,
    telegramChatPolicies: [createChatPolicy()],
    telegramAdminId: 900000222,
    telegramLinkUserIds: [],
    ...overrides
  };
}

describe('resolveAccessContext', () => {
  test('resolves configured group chats to configured_chat with policy', () => {
    const env = createEnv({
      telegramChatPolicies: [createChatPolicy({ commands: { sex: false } })]
    });

    expect(
      resolveAccessContext({
        env,
        chatId: -1001,
        chatType: 'supergroup',
        fromUserId: 123
      })
    ).toEqual({
      kind: 'configured_chat',
      policy: env.telegramChatPolicies[0]
    });
  });

  test('rejects unconfigured group chats', () => {
    const env = createEnv({
      telegramChatPolicies: [createChatPolicy()]
    });

    expect(
      resolveAccessContext({
        env,
        chatId: -2002,
        chatType: 'group',
        fromUserId: 123
      })
    ).toEqual({ kind: 'unauthorized' });
  });

  test('resolves operator private chat to private_admin', () => {
    const env = createEnv({ telegramAdminId: 900000222 });

    expect(
      resolveAccessContext({
        env,
        chatId: 900000222,
        chatType: 'private',
        fromUserId: 900000222
      })
    ).toEqual({ kind: 'private_admin' });
  });

  test('resolves configured link-only private users to private_link_sender', () => {
    const env = createEnv({ telegramLinkUserIds: [555] });

    expect(
      resolveAccessContext({
        env,
        chatId: 555,
        chatType: 'private',
        fromUserId: 555
      })
    ).toEqual({ kind: 'private_link_sender' });
  });

  test('chat orchestrator fails fast when accessContext is missing', async () => {
    const orchestrator = new ChatOrchestrator({
      db: {
        saveIncomingMessage: () => {
          throw new Error('should not save');
        }
      } as never,
      qwen: {} as never,
      env: createEnv(),
      lookupProvider: null,
      bot: {
        userId: 77,
        username: 'hrupa_bot',
        displayName: 'Assistant'
      },
      replyDispatcher: async () => ({ messageId: 1, createdAt: 'now' }),
      voiceDispatcher: async () => ({ messageId: 1, createdAt: 'now' }),
      memeDispatcher: async () => ({ messageId: 1, createdAt: 'now' }),
      editMessageTextDispatcher: async () => undefined,
      deleteMessageDispatcher: async () => undefined,
      sendChatAction: async () => undefined,
      delay: async () => undefined,
      logger: {
        child: () => ({
          debug: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
          child: () => {
            throw new Error('unreachable');
          }
        })
      } as never,
      now: () => 'now',
      random: () => 0
    });

    await expect(
      orchestrator.handleIncomingMessage({
        chatId: -1001,
        chatType: 'supergroup',
        messageId: 11,
        text: '/answer',
        createdAt: '2025-04-07T00:00:00.000Z',
        fromUserId: 123,
        fromUsername: 'artyom',
        fromFirstName: 'Artyom',
        fromLastName: null,
        fromDisplayName: 'Artyom',
        isBot: false,
        entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        replyToUserId: null,
        replyToMessageId: null,
        replyToMessageSnapshot: null,
        replyToMediaSnapshot: null,
        mediaSnapshot: null,
        chatTitle: 'Test',
        mediaGroupId: null
      } as never)
    ).rejects.toThrow('Missing access context for incoming message');
  });
});
