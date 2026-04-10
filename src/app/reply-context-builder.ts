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
    transcriptMessages
  };
}

function buildTranscriptMessages(
  db: ReplyContextDb,
  input: {
    reason: "mention" | "reply_to_bot" | "direct_message" | "interjection";
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

  if (input.reason === "reply_to_bot" && input.anchorParentMessage) {
    const anchorParentMessage = input.anchorParentMessage;
    const localTranscript = transcriptMessages.filter(
      (message) => message.messageId >= anchorParentMessage.messageId
    );

    return compactTranscript([
      ...localTranscript,
      anchorParentMessage,
      input.anchorBotMessage,
      input.triggerMessage
    ]);
  }

  if (input.reason === "reply_to_bot" && input.anchorBotMessage) {
    const anchorBotMessage = input.anchorBotMessage;
    const localTranscript = transcriptMessages.filter(
      (message) => message.messageId >= anchorBotMessage.messageId
    );

    return compactTranscript([...localTranscript, anchorBotMessage, input.triggerMessage]);
  }

  return compactTranscript([...transcriptMessages, input.triggerMessage]);
}

function emptyReplyContext(): ReplyContext {
  return {
    triggerMessage: null,
    anchorBotMessage: null,
    anchorParentMessage: null,
    transcriptMessages: []
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
