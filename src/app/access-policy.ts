import type { AppEnv } from '../config/env/index.js';
import type { AuthorizedMode, ChatType } from '../domain/models.js';

export function resolveAuthorizedMode(input: {
  env: AppEnv;
  chatId: number;
  chatType: ChatType;
  fromUserId: number | null;
}): AuthorizedMode | null {
  if (
    (input.chatType === 'group' || input.chatType === 'supergroup') &&
    input.chatId === input.env.telegramChatId
  ) {
    return 'chat';
  }

  if (
    input.chatType === 'private' &&
    input.fromUserId === input.env.telegramAdminId
  ) {
    return 'private_admin';
  }

  if (
    input.chatType === 'private' &&
    input.fromUserId !== null &&
    input.env.telegramLinkUserIds.includes(input.fromUserId)
  ) {
    return 'private_link_sender';
  }

  return null;
}
