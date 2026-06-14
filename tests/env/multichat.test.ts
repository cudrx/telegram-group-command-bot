import { describe, expect, test } from 'vitest';

import { createTestAccessConfig } from '../helpers/telegram-fixtures.js';
import {
  parseRawEnv,
  writeAccessConfigFile,
  writeAccessConfigTextFile,
  writeChatConfigFile,
  writeChatConfigTextFile
} from './support.js';

const validChatPolicies = [
  {
    chatId: -1001234567890,
    label: 'main',
    features: {
      answer: true,
      summarize: true,
      decide: true,
      translate: false,
      read: true,
      transcribe: false,
      meme: true,
      sex: false,
      direct_links: true
    }
  },
  {
    chatId: -1002222222222,
    features: {
      answer: false,
      summarize: true,
      decide: false,
      translate: true,
      read: false,
      transcribe: true,
      meme: false,
      sex: false,
      direct_links: false
    }
  }
];

describe('parseEnv multichat config', () => {
  test('parses TELEGRAM_CHAT_CONFIG_PATH and TELEGRAM_ACCESS_CONFIG_PATH', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile(validChatPolicies),
      TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
        createTestAccessConfig({ adminDefaultChatId: -1002222222222 })
      )
    });

    expect(env.telegramChatPolicies).toEqual([
      {
        chatId: -1001234567890,
        label: 'main',
        features: {
          answer: true,
          summarize: true,
          decide: true,
          translate: false,
          read: true,
          transcribe: false,
          meme: true,
          sex: false,
          direct_links: true
        }
      },
      {
        chatId: -1002222222222,
        label: null,
        features: {
          answer: false,
          summarize: true,
          decide: false,
          translate: true,
          read: false,
          transcribe: true,
          meme: false,
          sex: false,
          direct_links: false
        }
      }
    ]);
    expect(env.telegramAdminId).toBe(createTestAccessConfig().adminUserId);
    expect(env.telegramAdminDefaultChatId).toBe(-1002222222222);
    expect(env.telegramLinkUserIds).toEqual([]);
    expect(Object.hasOwn(env, 'telegramLegacyChatId')).toBe(false);
  });

  test('rejects duplicate chat ids in TELEGRAM_CHAT_CONFIG_PATH', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([
          {
            chatId: -1001234567890,
            features: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: true,
              sex: true,
              direct_links: true
            }
          },
          {
            chatId: -1001234567890,
            features: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: true,
              sex: true,
              direct_links: true
            }
          }
        ]),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig()
        )
      })
    ).toThrow(/duplicate chat id/i);
  });

  test('rejects unknown feature keys in TELEGRAM_CHAT_CONFIG_PATH', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([
          {
            chatId: -1001234567890,
            features: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: true,
              sex: false,
              direct_links: true,
              surprise: true
            }
          }
        ]),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig()
        )
      })
    ).toThrow(/0\.features.*surprise|unknown feature/i);
  });

  test('rejects unknown top-level chat fields with path context', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([
          {
            chatId: -1001234567890,
            labell: 'oops',
            features: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: true,
              sex: false,
              direct_links: true
            }
          }
        ]),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig()
        )
      })
    ).toThrow(/0.*labell|unknown field/i);
  });

  test('rejects unreadable TELEGRAM_CHAT_CONFIG_PATH files', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH:
          '/tmp/definitely-missing-telegram-chat-config.json',
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig()
        )
      })
    ).toThrow(/TELEGRAM_CHAT_CONFIG_PATH.*readable file/i);
  });

  test('rejects invalid JSON in TELEGRAM_CHAT_CONFIG_PATH files', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigTextFile('{"chatId":'),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig()
        )
      })
    ).toThrow(/TELEGRAM_CHAT_CONFIG_PATH.*json/i);
  });

  test('rejects unreadable TELEGRAM_ACCESS_CONFIG_PATH files', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile(validChatPolicies),
        TELEGRAM_ACCESS_CONFIG_PATH:
          '/tmp/definitely-missing-telegram-access-config.json'
      })
    ).toThrow(/TELEGRAM_ACCESS_CONFIG_PATH.*readable file/i);
  });

  test('rejects invalid JSON in TELEGRAM_ACCESS_CONFIG_PATH files', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile(validChatPolicies),
        TELEGRAM_ACCESS_CONFIG_PATH:
          writeAccessConfigTextFile('{"adminUserId":')
      })
    ).toThrow(/TELEGRAM_ACCESS_CONFIG_PATH.*json/i);
  });

  test('requires TELEGRAM_ACCESS_CONFIG_PATH admin default chat to reference a configured chat', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile(validChatPolicies),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig({ adminDefaultChatId: -1009999999999 })
        )
      })
    ).toThrow(/adminDefaultChatId.*configured chat/i);
  });

  test('defaults link user ids to an empty list and default chat to null', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile(validChatPolicies),
      TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile({
        adminUserId: createTestAccessConfig().adminUserId
      })
    });

    expect(env.telegramAdminDefaultChatId).toBeNull();
    expect(env.telegramLinkUserIds).toEqual([]);
  });

  test('accepts explicit link user ids from TELEGRAM_ACCESS_CONFIG_PATH', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile(validChatPolicies),
      TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
        createTestAccessConfig({
          adminDefaultChatId: -1001234567890,
          linkUserIds: [111, 222, 333]
        })
      )
    });

    expect(env.telegramLinkUserIds).toEqual([111, 222, 333]);
    expect(env.telegramAdminDefaultChatId).toBe(-1001234567890);
  });
});
