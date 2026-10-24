import { answerActionConfig } from '../config/runtime/index.js';
import type { DatabaseClient } from '../database/index.js';
import type { ReplyContext, StoredMessage } from '../domain/models.js';
import { boundMessage } from '../llm/prompts/transcript.js';

type ContextDb = Pick<
  DatabaseClient,
  'getMessagesBefore' | 'getMessageByTelegramMessageId'
>;

export function buildAssistantContext(input: {
  db: ContextDb;
  triggerMessage: StoredMessage;
  contextLimit: number;
  botUserId: number;
  replyToMessageSnapshot?: StoredMessage | null;
}): ReplyContext {
  const { db, triggerMessage: trigger } = input;
  const config = answerActionConfig.context;
  const safeAnchor = resolveReplyAnchor(
    db,
    trigger,
    input.replyToMessageSnapshot
  );
  const recent = db.getMessagesBefore(
    trigger.chatId,
    trigger.messageId,
    config.scanLimit + 1
  );
  const candidates = new Map<
    number,
    { message: StoredMessage; score: number }
  >();
  const terms = new Set(
    `${trigger.text} ${safeAnchor?.text ?? ''}`
      .toLowerCase()
      .match(/[\p{L}\p{N}_]{3,}/gu) ?? []
  );
  const add = (message: StoredMessage, score: number) => {
    if (
      message.chatId !== trigger.chatId ||
      message.messageId >= trigger.messageId
    )
      return;
    if ((candidates.get(message.messageId)?.score ?? -1) >= score) return;

    candidates.set(message.messageId, { message, score });
  };

  for (const [index, message] of recent.slice(-config.scanLimit).entries()) {
    if (message.isBot && message.userId !== input.botUserId) continue;

    const words = new Set(
      message.text.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? []
    );
    const overlap = [...terms].filter((term) => words.has(term)).length;
    add(
      message,
      index +
        overlap * config.scoring.lexicalMatch +
        (message.userId === trigger.userId ? config.scoring.sameAuthor : 0)
    );
  }

  if (safeAnchor) {
    for (const message of db.getMessagesBefore(
      trigger.chatId,
      safeAnchor.messageId,
      config.anchorNeighborLimit
    )) {
      if (!message.isBot || message.userId === input.botUserId)
        add(message, config.scoring.anchorNeighbor);
    }
  }

  // Expand only stored explicit links; never invent edges from lexical similarity.
  const roots = [
    safeAnchor,
    ...[...candidates.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, config.maxReplyRoots)
      .map((item) => item.message)
  ];
  let incompleteReplyChain = false;
  for (const root of roots) {
    let message = root;
    for (let depth = 0; message && depth < config.maxReplyDepth; depth++) {
      if (root === safeAnchor || depth > 0)
        add(
          message,
          (root === safeAnchor
            ? config.scoring.targetAncestor
            : config.scoring.replyAncestor) - depth
        );
      const parentId: number | null = message.replyToMessageId;
      if (!parentId || parentId >= message.messageId) break;

      message =
        candidates.get(parentId)?.message ??
        db.getMessageByTelegramMessageId(trigger.chatId, parentId);
      if (!message || depth === config.maxReplyDepth - 1)
        incompleteReplyChain = true;
    }
  }

  const ranked = [...candidates.values()].sort(
    (a, b) => b.score - a.score || b.message.messageId - a.message.messageId
  );
  const candidatesInOrder = ranked
    .map(({ message }) => message)
    .filter((message) => message.messageId !== safeAnchor?.messageId);
  const selected = candidatesInOrder
    .slice(0, input.contextLimit)
    .map(boundMessage);
  const truncated =
    recent.length > config.scanLimit ||
    incompleteReplyChain ||
    candidatesInOrder.length > selected.length ||
    selected.some(
      (message, index) => message.text !== candidatesInOrder[index]?.text
    ) ||
    Boolean(safeAnchor && boundMessage(safeAnchor).text !== safeAnchor.text);
  const priorityMessageIds = selected.map((message) => message.messageId);
  selected.sort((a, b) => a.messageId - b.messageId);

  return {
    triggerMessage: boundMessage(trigger),
    replyAnchorMessage: safeAnchor ? boundMessage(safeAnchor) : null,
    priorContextMessages: selected,
    contextMetadata: {
      truncated,
      includedMessageCount: selected.length,
      priorityMessageIds
    }
  };
}

export function resolveReplyAnchor(
  db: ContextDb,
  trigger: StoredMessage,
  snapshot?: StoredMessage | null
): StoredMessage | null {
  if (!trigger.replyToMessageId) return null;

  const anchor =
    db.getMessageByTelegramMessageId(
      trigger.chatId,
      trigger.replyToMessageId
    ) ?? snapshot;
  return anchor?.chatId === trigger.chatId &&
    anchor.messageId === trigger.replyToMessageId &&
    anchor.messageId < trigger.messageId
    ? anchor
    : null;
}
