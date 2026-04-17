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
  messageContextLimit: number;
}): ReplyContext {
  const triggerMessage = input.db.getMessageByTelegramMessageId(
    input.chatId,
    input.triggerMessageId
  );

  if (!triggerMessage) {
    return emptyReplyContext();
  }

  return {
    triggerMessage,
    priorContextMessages: buildPriorContextMessages(input.db, {
      chatId: input.chatId,
      triggerMessageId: input.triggerMessageId,
      messageContextLimit: input.messageContextLimit
    })
  };
}

function buildPriorContextMessages(
  db: ReplyContextDb,
  input: {
    chatId: number;
    triggerMessageId: number;
    messageContextLimit: number;
  }
): StoredMessage[] {
  const priorContextLimit = Math.max(input.messageContextLimit - 1, 0);

  if (priorContextLimit === 0) {
    return [];
  }

  const lookbackLimit = Math.max(input.messageContextLimit * 4, priorContextLimit);
  const priorMessages = db.getMessagesBefore(input.chatId, input.triggerMessageId, lookbackLimit);
  const humanMessages = priorMessages.filter((message) => !message.isBot);

  return compactTranscript(humanMessages.slice(-priorContextLimit));
}

function emptyReplyContext(): ReplyContext {
  return {
    triggerMessage: null,
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
