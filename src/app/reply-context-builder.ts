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
  reason: "mention" | "reply_to_bot" | "direct_message" | "interjection";
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
  const transcriptMessages = buildTranscriptMessages(input.db, {
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
    transcriptMessages
  };
}

function buildTranscriptMessages(
  db: ReplyContextDb,
  input: {
    chatId: number;
    triggerMessage: StoredMessage;
    anchorBotMessage: StoredMessage | null;
    anchorParentMessage: StoredMessage | null;
    triggerMessageId: number;
    messageContextLimit: number;
  }
): StoredMessage[] {
  const lookbackLimit = Math.max(input.messageContextLimit - 1, 0);
  const transcriptMessages = db.getMessagesBefore(
    input.chatId,
    input.triggerMessageId,
    lookbackLimit
  );
  const transcriptById = new Map<number, StoredMessage>();

  for (const message of [
    ...transcriptMessages,
    input.anchorParentMessage,
    input.anchorBotMessage,
    input.triggerMessage
  ]) {
    if (message) {
      transcriptById.set(message.messageId, message);
    }
  }

  return Array.from(transcriptById.values()).sort((left, right) => left.messageId - right.messageId);
}

function emptyReplyContext(): ReplyContext {
  return {
    triggerMessage: null,
    anchorBotMessage: null,
    anchorParentMessage: null,
    transcriptMessages: []
  };
}
