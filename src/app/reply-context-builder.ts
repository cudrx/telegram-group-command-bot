import type {
  AssistantIntent,
  ReplyContext,
  StoredMessage
} from '../domain/models.js';
import type { DatabaseClient } from '../storage/database.js';

type ReplyContextDb = Pick<
  DatabaseClient,
  'getMessageByTelegramMessageId' | 'getMessagesBefore'
>;

export function buildReplyContext(input: {
  db: ReplyContextDb;
  chatId: number;
  triggerMessageId: number;
  contextLimit: number;
  intent: AssistantIntent;
  botUserId: number;
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
    replyAnchorMessage: buildReplyAnchorMessage(input.db, {
      chatId: input.chatId,
      triggerMessage,
      intent: input.intent,
      botUserId: input.botUserId
    }),
    priorContextMessages: buildPriorContextMessages(input.db, {
      chatId: input.chatId,
      triggerMessageId: input.triggerMessageId,
      contextLimit: input.contextLimit
    })
  };
}

function buildReplyAnchorMessage(
  db: ReplyContextDb,
  input: {
    chatId: number;
    triggerMessage: StoredMessage;
    intent: AssistantIntent;
    botUserId: number;
  }
): StoredMessage | null {
  if (input.intent !== 'explain' || !input.triggerMessage.replyToMessageId) {
    return null;
  }

  const anchor = db.getMessageByTelegramMessageId(
    input.chatId,
    input.triggerMessage.replyToMessageId
  );

  if (!anchor || anchor.userId === input.botUserId) {
    return null;
  }

  return anchor;
}

function buildPriorContextMessages(
  db: ReplyContextDb,
  input: {
    chatId: number;
    triggerMessageId: number;
    contextLimit: number;
  }
): StoredMessage[] {
  const priorContextLimit = Math.max(input.contextLimit - 1, 0);

  if (priorContextLimit === 0) {
    return [];
  }

  const lookbackLimit = Math.max(input.contextLimit * 4, priorContextLimit);
  const priorMessages = db.getMessagesBefore(
    input.chatId,
    input.triggerMessageId,
    lookbackLimit
  );
  const humanMessages = priorMessages.filter((message) => !message.isBot);

  return compactTranscript(humanMessages.slice(-priorContextLimit));
}

function emptyReplyContext(): ReplyContext {
  return {
    triggerMessage: null,
    replyAnchorMessage: null,
    priorContextMessages: []
  };
}

function compactTranscript(
  messages: Array<StoredMessage | null>
): StoredMessage[] {
  const transcriptById = new Map<number, StoredMessage>();

  for (const message of messages) {
    if (message) {
      transcriptById.set(message.messageId, message);
    }
  }

  return Array.from(transcriptById.values()).sort(
    (left, right) => left.messageId - right.messageId
  );
}
