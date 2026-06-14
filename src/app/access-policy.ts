import type { AppEnv } from '../config/env/index.js';
import type { AccessContext, ChatType } from '../domain/models.js';

export function resolveAccessContext(input: {
  env: AppEnv;
  chatId: number;
  chatType: ChatType;
  fromUserId: number | null;
}): AccessContext {
  if (input.chatType === 'group' || input.chatType === 'supergroup') {
    const policy = input.env.telegramChatPolicies.find(
      (candidate) => candidate.chatId === input.chatId
    );

    if (policy) {
      return {
        kind: 'configured_chat',
        policy
      };
    }

    return { kind: 'unauthorized' };
  }

  if (
    input.chatType === 'private' &&
    input.fromUserId === input.env.telegramAdminId
  ) {
    return { kind: 'private_admin' };
  }

  if (
    input.chatType === 'private' &&
    input.fromUserId !== null &&
    input.env.telegramLinkUserIds.includes(input.fromUserId)
  ) {
    return { kind: 'private_link_sender' };
  }

  return { kind: 'unauthorized' };
}
