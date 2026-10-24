import type { DatabaseClient } from '../database/index.js';
import type {
  AssistantIntent,
  ReplyContext,
  StoredMessage
} from '../domain/models.js';
import {
  buildAssistantContext,
  resolveReplyAnchor
} from './assistant-context.js';

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
  replyToMessageSnapshot?: StoredMessage | null;
}): ReplyContext {
  const triggerMessage = input.db.getMessageByTelegramMessageId(
    input.chatId,
    input.triggerMessageId
  );

  if (!triggerMessage) {
    return emptyReplyContext();
  }

  if (input.intent === 'answer') {
    return buildAssistantContext({ ...input, triggerMessage });
  }

  const priorContext = buildPriorContextMessages(input.db, {
    chatId: input.chatId,
    triggerMessageId: input.triggerMessageId,
    contextLimit: input.contextLimit
  });

  return {
    triggerMessage,
    replyAnchorMessage:
      input.intent === 'translate'
        ? resolveReplyAnchor(
            input.db,
            triggerMessage,
            input.replyToMessageSnapshot
          )
        : null,
    priorContextMessages: priorContext.messages,
    contextMetadata: {
      truncated: priorContext.truncated,
      includedMessageCount: priorContext.messages.length
    }
  };
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

  const messages = humanMessages.slice(-priorContextLimit);

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
