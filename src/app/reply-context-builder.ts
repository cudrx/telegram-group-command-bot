import type { ReplyContext, StoredMessage } from "../domain/models.js";
import type { DatabaseClient } from "../storage/database.js";

type ReplyContextDb = Pick<
  DatabaseClient,
  "getMessageByTelegramMessageId" | "getMessagesBefore"
>;

export function buildReplyContext(input: {
  db: ReplyContextDb;
  chatId: number;
  triggerMessageId: number;
  reason: "mention" | "reply_to_bot";
  messageContextLimit: number;
}): ReplyContext {
  const triggerMessage = input.db.getMessageByTelegramMessageId(
    input.chatId,
    input.triggerMessageId
  );

  if (!triggerMessage) {
    return emptyReplyContext();
  }

  const anchorBotMessage =
    input.reason === "reply_to_bot" && triggerMessage.replyToMessageId !== null
      ? input.db.getMessageByTelegramMessageId(input.chatId, triggerMessage.replyToMessageId)
      : null;
  const anchorParentMessage =
    anchorBotMessage !== null && anchorBotMessage.replyToMessageId !== null
      ? input.db.getMessageByTelegramMessageId(input.chatId, anchorBotMessage.replyToMessageId)
      : null;
  const priorContextMessages = buildPriorContextMessages(input.db, {
    reason: input.reason,
    chatId: input.chatId,
    triggerMessage,
    anchorBotMessage,
    anchorParentMessage,
    triggerMessageId: input.triggerMessageId,
    messageContextLimit: input.messageContextLimit
  });

  return {
    triggerMessage,
    anchorBotMessage,
    anchorParentMessage,
    priorContextMessages
  };
}

function buildPriorContextMessages(
  db: ReplyContextDb,
  input: {
    reason: "mention" | "reply_to_bot";
    chatId: number;
    triggerMessage: StoredMessage;
    anchorBotMessage: StoredMessage | null;
    anchorParentMessage: StoredMessage | null;
    triggerMessageId: number;
    messageContextLimit: number;
  }
): StoredMessage[] {
  const lookbackLimit = Math.max(input.messageContextLimit - 1, 0);
  const priorMessages = db.getMessagesBefore(
    input.chatId,
    input.triggerMessageId,
    lookbackLimit
  );

  if (input.reason === "reply_to_bot" && input.anchorBotMessage) {
    const lowerBound =
      input.anchorParentMessage?.messageId ?? input.anchorBotMessage.messageId;
    const localPriorContext = priorMessages.filter(
      (message) =>
        message.messageId >= lowerBound &&
        message.messageId !== input.anchorBotMessage?.messageId &&
        message.messageId !== input.triggerMessage.messageId &&
        !message.isBot
    );

    return compactTranscript(localPriorContext);
  }

  return compactTranscript(priorMessages.filter((message) => !message.isBot));
}

function emptyReplyContext(): ReplyContext {
  return {
    triggerMessage: null,
    anchorBotMessage: null,
    anchorParentMessage: null,
    priorContextMessages: []
  };
}

function compactTranscript(messages: Array<StoredMessage | null>): StoredMessage[] {
  const transcriptById = new Map<number, StoredMessage>();

  for (const message of messages) {
    if (message) {
      transcriptById.set(message.messageId, message);
    }
  }

  return Array.from(transcriptById.values()).sort((left, right) => left.messageId - right.messageId);
}
