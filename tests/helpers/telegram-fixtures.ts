import type { ChatPolicy } from '../../src/config/env/types.js';

export const TEST_CONFIGURED_CHAT_ID = -1009000001111;
export const TEST_OPERATOR_CHAT_ID = 900000222;

export const FULLY_ENABLED_CHAT_FEATURES: ChatPolicy['features'] = {
  answer: true,
  summarize: true,
  decide: true,
  translate: true,
  read: true,
  transcribe: true,
  meme: true,
  sex: true,
  direct_links: true
};

export function createTestChatPolicy(
  overrides: Partial<ChatPolicy> = {}
): ChatPolicy {
  return {
    chatId: TEST_CONFIGURED_CHAT_ID,
    label: 'default',
    features: FULLY_ENABLED_CHAT_FEATURES,
    ...overrides
  };
}

export function createTestAccessConfig(
  overrides: {
    adminUserId?: number;
    adminDefaultChatId?: number | null;
    linkUserIds?: number[];
  } = {}
) {
  return {
    adminUserId: TEST_OPERATOR_CHAT_ID,
    adminDefaultChatId: TEST_CONFIGURED_CHAT_ID,
    linkUserIds: [],
    ...overrides
  };
}
