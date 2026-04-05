import type { Context } from "grammy";

import type { ChatType, NormalizedMessage } from "../../domain/models.js";

export function normalizeTextMessage(ctx: Context): NormalizedMessage | null {
  const message = ctx.message;

  if (!message || !("text" in message) || typeof message.text !== "string") {
    return null;
  }

  const text = message.text.trim();

  if (text.length === 0) {
    return null;
  }

  const fullName = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const displayName =
    message.from?.username ?? (fullName.length > 0 ? fullName : "Unknown");
  const chatTitle = "title" in message.chat ? message.chat.title ?? null : null;

  return {
    chatId: message.chat.id,
    chatType: normalizeChatType(message.chat.type),
    chatTitle,
    messageId: message.message_id,
    text,
    createdAt: new Date(message.date * 1000).toISOString(),
    fromUserId: message.from?.id ?? null,
    fromUsername: message.from?.username ?? null,
    fromFirstName: message.from?.first_name ?? null,
    fromDisplayName: displayName,
    isBot: message.from?.is_bot ?? false,
    entities: (message.entities ?? []).map((entity) => ({
      type: entity.type,
      offset: entity.offset,
      length: entity.length
    })),
    replyToUserId: message.reply_to_message?.from?.id ?? null
  };
}

function normalizeChatType(type: string): ChatType {
  switch (type) {
    case "private":
    case "group":
    case "supergroup":
    case "channel":
      return type;
    default:
      return "unknown";
  }
}
