import type { ChatPolicy } from '../../src/config/env/types.js';

export const TEST_CONFIGURED_CHAT_ID = -1009000001111;
export const TEST_OPERATOR_CHAT_ID = 900000222;

export const FULLY_ENABLED_CHAT_COMMANDS: ChatPolicy['commands'] = {
  answer: true,
  summarize: true,
  decide: true,
  translate: true,
  read: true,
  transcribe: true,
  meme: true,
  sex: true
};

export const FULLY_ENABLED_CHAT_FEATURES: ChatPolicy['features'] = {
  direct_links: true,
  deploy_announcements: false
};

export const DEFAULT_REDDIT_SOURCES: ChatPolicy['reddit_sources'] = {
  meme: ['SipsTea', 'Unexpected'],
  sex: ['LadyBoners', 'WatchItForThePlot']
};

export function createTestChatPolicy(
  overrides: Omit<Partial<ChatPolicy>, 'commands' | 'features'> & {
    commands?: Partial<ChatPolicy['commands']>;
    features?: Partial<ChatPolicy['features']>;
    reddit_sources?: Partial<ChatPolicy['reddit_sources']>;
  } = {}
): ChatPolicy {
  const { commands, features, reddit_sources, ...rest } = overrides;

  return {
    chatId: TEST_CONFIGURED_CHAT_ID,
    label: 'default',
    commands: {
      ...FULLY_ENABLED_CHAT_COMMANDS,
      ...commands
    },
    features: {
      ...FULLY_ENABLED_CHAT_FEATURES,
      ...features
    },
    reddit_sources: {
      ...DEFAULT_REDDIT_SOURCES,
      ...reddit_sources
    },
    ...rest
  };
}

export function createTestAccessConfig(
  overrides: { adminUserId?: number; linkUserIds?: number[] } = {}
) {
  return {
    adminUserId: TEST_OPERATOR_CHAT_ID,
    linkUserIds: [],
    ...overrides
  };
}
