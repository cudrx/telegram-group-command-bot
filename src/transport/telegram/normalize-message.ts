import type { Context } from 'grammy';

import type { ChatType, NormalizedMessage } from '../../domain/models.js';
import {
  extractMessageMediaSnapshot,
  extractReplyToMediaSnapshot
} from '../../media/telegram-media.js';

type TelegramTextPayloadMessage = {
  text?: unknown;
  caption?: unknown;
  entities?: Array<{ type: string; offset: number; length: number }>;
  caption_entities?: Array<{ type: string; offset: number; length: number }>;
};

export function normalizeTextMessage(ctx: Context): NormalizedMessage | null {
  const message = ctx.message;

  if (!message) {
    return null;
  }

  const textPayload = normalizeMessageTextPayload(message);

  if (!textPayload) {
    return null;
  }

  const displayName = formatSenderDisplayName({
    firstName: message.from?.first_name ?? null,
    lastName: message.from?.last_name ?? null,
    username: message.from?.username ?? null
  });
  const chatTitle =
    'title' in message.chat ? (message.chat.title ?? null) : null;

  return {
    chatId: message.chat.id,
    chatType: normalizeChatType(message.chat.type),
    chatTitle,
    messageId: message.message_id,
    mediaGroupId: normalizeMediaGroupId(
      'media_group_id' in message ? message.media_group_id : null
    ),
    text: textPayload.text,
    createdAt: new Date(message.date * 1000).toISOString(),
    fromUserId: message.from?.id ?? null,
    fromUsername: message.from?.username ?? null,
    fromFirstName: message.from?.first_name ?? null,
    fromLastName: message.from?.last_name ?? null,
    fromDisplayName: displayName,
    isBot: message.from?.is_bot ?? false,
    entities: textPayload.entities.map((entity) => ({
      type: entity.type,
      offset: entity.offset,
      length: entity.length
    })),
    replyToUserId: message.reply_to_message?.from?.id ?? null,
    replyToMessageId: message.reply_to_message?.message_id ?? null,
    replyToMessageSnapshot: normalizeReplyToMessageSnapshot(message),
    replyToMediaSnapshot: extractReplyToMediaSnapshot(message),
    mediaSnapshot: extractMessageMediaSnapshot(message)
  };
}

function normalizeReplyToMessageSnapshot(
  message: NonNullable<Context['message']>
): NormalizedMessage['replyToMessageSnapshot'] {
  const reply = message.reply_to_message;

  if (!reply) {
    return null;
  }

  const textPayload = normalizeMessageTextPayload(reply);

  if (!textPayload) {
    return null;
  }

  return {
    chatId: message.chat.id,
    messageId: reply.message_id,
    mediaGroupId: normalizeMediaGroupId(
      'media_group_id' in reply ? reply.media_group_id : null
    ),
    userId: reply.from?.id ?? null,
    senderDisplayName: formatSenderDisplayName({
      firstName: reply.from?.first_name ?? null,
      lastName: reply.from?.last_name ?? null,
      username: reply.from?.username ?? null
    }),
    text: textPayload.text,
    createdAt: new Date(reply.date * 1000).toISOString(),
    isBot: reply.from?.is_bot ?? false,
    replyToMessageId: null,
    mediaSnapshot: extractMessageMediaSnapshot(reply)
  };
}

function normalizeMessageTextPayload(message: TelegramTextPayloadMessage): {
  text: string;
  entities: Array<{ type: string; offset: number; length: number }>;
} | null {
  if ('text' in message && typeof message.text === 'string') {
    const text = message.text.trim();

    if (text.length === 0) {
      return null;
    }

    return {
      text,
      entities: (message.entities ?? []).map(normalizeEntity)
    };
  }

  if ('caption' in message && typeof message.caption === 'string') {
    const text = message.caption.trim();

    if (text.length === 0) {
      return null;
    }

    return {
      text,
      entities: (message.caption_entities ?? []).map(normalizeEntity)
    };
  }

  if (extractMessageMediaSnapshot(message as NonNullable<Context['message']>)) {
    return {
      text: '',
      entities: []
    };
  }

  return null;
}

function normalizeEntity(entity: {
  type: string;
  offset: number;
  length: number;
}): {
  type: string;
  offset: number;
  length: number;
} {
  return {
    type: entity.type,
    offset: entity.offset,
    length: entity.length
  };
}

export function formatSenderDisplayName(input: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}): string {
  const fullName = [input.firstName, input.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  if (fullName.length > 0 && input.username) {
    return `${fullName} (@${input.username})`;
  }

  if (input.firstName && input.username) {
    return `${input.firstName} (@${input.username})`;
  }

  if (fullName.length > 0) {
    return fullName;
  }

  if (input.username) {
    return `@${input.username}`;
  }

  return 'Unknown';
}

function normalizeChatType(type: string): ChatType {
  switch (type) {
    case 'private':
    case 'group':
    case 'supergroup':
    case 'channel':
      return type;
    default:
      return 'unknown';
  }
}

function normalizeMediaGroupId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}
