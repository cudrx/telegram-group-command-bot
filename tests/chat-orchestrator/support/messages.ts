import type { IncomingMessage } from '../../../src/app/chat-orchestrator/types.js';
import type { ChatPolicy } from '../../../src/config/env/types.js';
import type { NormalizedMessage } from '../../../src/domain/models.js';
import { createTestChatPolicy } from '../../helpers/telegram-fixtures.js';

export function createIncomingMessage(
  overrides: Partial<Omit<NormalizedMessage, 'accessContext'>> & {
    accessContext?: IncomingMessage['accessContext'];
  } = {}
): IncomingMessage {
  const message: NormalizedMessage = {
    chatId: 1,
    chatType: 'group',
    chatTitle: 'Friends',
    messageId: 1,
    mediaGroupId: null,
    text: 'обычное сообщение',
    createdAt: '2026-04-03T12:00:00.000Z',
    fromUserId: 42,
    fromUsername: 'tom',
    fromFirstName: 'Tom',
    fromLastName: null,
    fromDisplayName: 'Tom',
    isBot: false,
    entities: [],
    replyToUserId: null,
    replyToMessageId: null,
    replyToMessageSnapshot: null,
    replyToMediaSnapshot: null,
    mediaSnapshot: null,
    ...overrides
  };

  return {
    ...message,
    accessContext:
      overrides.accessContext ?? resolveDefaultAccessContext(message)
  };
}

function resolveDefaultAccessContext(
  message: Pick<NormalizedMessage, 'authorizedMode' | 'chatId' | 'chatType'>
): IncomingMessage['accessContext'] {
  if (message.authorizedMode === 'private_admin') {
    return { kind: 'private_admin' };
  }

  if (message.authorizedMode === 'private_link_sender') {
    return { kind: 'private_link_sender' };
  }

  if (message.chatType === 'private') {
    return { kind: 'private_admin' };
  }

  return {
    kind: 'configured_chat',
    policy: createPolicy(message.chatId)
  };
}

function createPolicy(chatId: number): ChatPolicy {
  return createTestChatPolicy({ chatId });
}
