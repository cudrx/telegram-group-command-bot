import type { DatabaseClient } from '../database/index.js';
import type {
  AssistantIntent,
  ReplyContext,
  StoredMessage
} from '../domain/models.js';

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

  const priorContext = buildPriorContextMessages(input.db, {
    chatId: input.chatId,
    triggerMessageId: input.triggerMessageId,
    contextLimit: input.contextLimit
  });

  return {
    triggerMessage,
    replyAnchorMessage: buildReplyAnchorMessage(input.db, {
      chatId: input.chatId,
      triggerMessage,
      intent: input.intent,
      botUserId: input.botUserId
    }),
    priorContextMessages: priorContext.messages,
    contextMetadata: {
      truncated: priorContext.truncated,
      includedMessageCount: priorContext.messages.length
    }
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
  if (!usesReplyAnchor(input.intent)) {
    return null;
  }

  const anchor = input.triggerMessage.replyToMessageId
    ? db.getMessageByTelegramMessageId(
        input.chatId,
        input.triggerMessage.replyToMessageId
      )
    : buildAnswerPreviousMessageAnchor(db, {
        chatId: input.chatId,
        triggerMessage: input.triggerMessage,
        intent: input.intent
      });

  if (
    !anchor ||
    (anchor.userId === input.botUserId && input.intent !== 'translate')
  ) {
    return null;
  }

  return anchor;
}

function buildAnswerPreviousMessageAnchor(
  db: ReplyContextDb,
  input: {
    chatId: number;
    triggerMessage: StoredMessage;
    intent: AssistantIntent;
  }
): StoredMessage | null {
  if (input.intent !== 'answer') {
    return null;
  }

  return (
    db.getMessagesBefore(input.chatId, input.triggerMessage.messageId, 1)[0] ??
    null
  );
}

function usesReplyAnchor(intent: AssistantIntent): boolean {
  return intent === 'answer' || intent === 'translate';
}

function buildPriorContextMessages(
  db: ReplyContextDb,
  input: {
    chatId: number;
    triggerMessageId: number;
    contextLimit: number;
  }
): { messages: StoredMessage[]; truncated: boolean } {
  const priorContextLimit = Math.max(input.contextLimit - 1, 0);

  if (priorContextLimit === 0) {
    return { messages: [], truncated: false };
  }

  const batchSize = Math.max(input.contextLimit * 4, 32);
  const humanMessages: StoredMessage[] = [];
  let beforeMessageId = input.triggerMessageId;

  while (humanMessages.length <= priorContextLimit) {
    const batch = db.getMessagesBefore(
      input.chatId,
      beforeMessageId,
      batchSize
    );

    if (batch.length === 0) break;

    humanMessages.unshift(...batch.filter((message) => !message.isBot));
    beforeMessageId = batch[0]?.messageId ?? beforeMessageId;

    if (batch.length < batchSize) break;
  }

  const messages = compactTranscript(humanMessages.slice(-priorContextLimit));

  return {
    messages,
    truncated: humanMessages.length > messages.length
  };
}

function emptyReplyContext(): ReplyContext {
  return {
    triggerMessage: null,
    replyAnchorMessage: null,
    priorContextMessages: [],
    contextMetadata: { truncated: false, includedMessageCount: 0 }
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
