import type { NormalizedMessage } from '../../../src/domain/models.js';

export function createIncomingMessage(
  overrides: Partial<NormalizedMessage> = {}
): NormalizedMessage {
  return {
    chatId: 1,
    chatType: 'group',
    chatTitle: 'Friends',
    messageId: 1,
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
}
