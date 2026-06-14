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
    commands: {
      answer: true,
      summarize: true,
      decide: true,
      translate: false,
      read: true,
      transcribe: false,
      meme: true,
      sex: false
    },
    features: {
      direct_links: true,
      deploy_announcements: true
    },
    reddit_sources: {
      meme: ['SipsTea', 'Unexpected'],
      sex: ['LadyBoners']
    }
  },
  {
    chatId: -1002222222222,
    commands: {
      answer: false,
      summarize: true,
      decide: false,
      translate: true,
      read: false,
      transcribe: true,
      meme: false,
      sex: false
    },
    features: {
      direct_links: false,
      deploy_announcements: false
    },
    reddit_sources: {
      meme: ['memes'],
      sex: ['WatchItForThePlot']
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
        createTestAccessConfig()
      )
    });

    expect(env.telegramChatPolicies).toEqual([
      {
        chatId: -1001234567890,
        label: 'main',
        commands: {
          answer: true,
          summarize: true,
          decide: true,
          translate: false,
          read: true,
          transcribe: false,
          meme: true,
          sex: false
        },
        features: {
          direct_links: true,
          deploy_announcements: true
        },
        reddit_sources: {
          meme: ['SipsTea', 'Unexpected'],
          sex: ['LadyBoners']
        }
      },
      {
        chatId: -1002222222222,
        label: null,
        commands: {
          answer: false,
          summarize: true,
          decide: false,
          translate: true,
          read: false,
          transcribe: true,
          meme: false,
          sex: false
        },
        features: {
          direct_links: false,
          deploy_announcements: false
        },
        reddit_sources: {
          meme: ['memes'],
          sex: ['WatchItForThePlot']
        }
      }
    ]);
    expect(env.telegramAdminId).toBe(createTestAccessConfig().adminUserId);
    expect(Object.hasOwn(env, 'telegramAdminDefaultChatId')).toBe(false);
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
            commands: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: true,
              sex: true
            },
            features: {
              direct_links: true,
              deploy_announcements: false
            },
            reddit_sources: {
              meme: ['memes'],
              sex: ['WatchItForThePlot']
            }
          },
          {
            chatId: -1001234567890,
            commands: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: true,
              sex: true
            },
            features: {
              direct_links: true,
              deploy_announcements: false
            },
            reddit_sources: {
              meme: ['memes'],
              sex: ['WatchItForThePlot']
            }
          }
        ]),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig()
        )
      })
    ).toThrow(/duplicate chat id/i);
  });

  test('rejects unknown command keys in TELEGRAM_CHAT_CONFIG_PATH', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([
          {
            chatId: -1001234567890,
            commands: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: true,
              sex: false,
              surprise: true
            },
            features: {
              direct_links: true,
              deploy_announcements: false
            },
            reddit_sources: {
              meme: ['memes'],
              sex: ['WatchItForThePlot']
            }
          }
        ]),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig()
        )
      })
    ).toThrow(/0\.commands.*surprise|unknown field/i);
  });

  test('rejects unknown feature keys in TELEGRAM_CHAT_CONFIG_PATH', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([
          {
            chatId: -1001234567890,
            commands: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: true,
              sex: false
            },
            features: {
              direct_links: true,
              deploy_announcements: false,
              surprise: true
            },
            reddit_sources: {
              meme: ['memes'],
              sex: ['WatchItForThePlot']
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
            commands: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: true,
              sex: false
            },
            features: {
              direct_links: true,
              deploy_announcements: false
            },
            reddit_sources: {
              meme: ['memes'],
              sex: ['WatchItForThePlot']
            }
          }
        ]),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig()
        )
      })
    ).toThrow(/0.*labell|unknown field/i);
  });

  test('requires meme reddit sources when /meme is enabled', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([
          {
            chatId: -1001234567890,
            commands: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: true,
              sex: false
            },
            features: {
              direct_links: true,
              deploy_announcements: false
            }
          }
        ]),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig()
        )
      })
    ).toThrow(/reddit_sources\.meme.*required|reddit_sources\.meme/i);
  });

  test('requires sex reddit sources when /sex is enabled', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([
          {
            chatId: -1001234567890,
            commands: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: false,
              sex: true
            },
            features: {
              direct_links: true,
              deploy_announcements: false
            },
            reddit_sources: {
              meme: ['memes']
            }
          }
        ]),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig()
        )
      })
    ).toThrow(/reddit_sources\.sex.*required|reddit_sources\.sex/i);
  });

  test('rejects empty reddit source lists for enabled commands', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile([
          {
            chatId: -1001234567890,
            commands: {
              answer: true,
              summarize: true,
              decide: true,
              translate: true,
              read: true,
              transcribe: true,
              meme: true,
              sex: false
            },
            features: {
              direct_links: true,
              deploy_announcements: false
            },
            reddit_sources: {
              meme: [],
              sex: ['WatchItForThePlot']
            }
          }
        ]),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
          createTestAccessConfig()
        )
      })
    ).toThrow(/reddit_sources\.meme.*at least 1|reddit_sources\.meme/i);
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

  test('rejects retired adminDefaultChatId in TELEGRAM_ACCESS_CONFIG_PATH', () => {
    expect(() =>
      parseRawEnv({
        TELEGRAM_BOT_TOKEN: 'telegram-token',
        LLM_API_KEY: 'llm-key',
        TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile(validChatPolicies),
        TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile({
          adminUserId: createTestAccessConfig().adminUserId,
          adminDefaultChatId: -1009999999999
        })
      })
    ).toThrow(/adminDefaultChatId|unknown field/i);
  });

  test('defaults link user ids to an empty list', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile(validChatPolicies),
      TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile({
        adminUserId: createTestAccessConfig().adminUserId
      })
    });

    expect(Object.hasOwn(env, 'telegramAdminDefaultChatId')).toBe(false);
    expect(env.telegramLinkUserIds).toEqual([]);
  });

  test('accepts explicit link user ids from TELEGRAM_ACCESS_CONFIG_PATH', () => {
    const env = parseRawEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      TELEGRAM_CHAT_CONFIG_PATH: writeChatConfigFile(validChatPolicies),
      TELEGRAM_ACCESS_CONFIG_PATH: writeAccessConfigFile(
        createTestAccessConfig({
          linkUserIds: [111, 222, 333]
        })
      )
    });

    expect(env.telegramLinkUserIds).toEqual([111, 222, 333]);
    expect(Object.hasOwn(env, 'telegramAdminDefaultChatId')).toBe(false);
  });
});
