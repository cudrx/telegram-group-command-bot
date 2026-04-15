import type { ReplyContext, ReplyReason, StoredMessage } from "../domain/models.js";
import {
  hasRepeatedShortReplyAnchor,
  isNearDuplicateReplyText
} from "../domain/reply-text-similarity.js";

const REPETITIVE_ANCHOR_OMISSION =
  "[previous bot reply omitted because it appears repetitive]";
const UNSAFE_ANCHOR_OMISSION =
  "[previous bot reply omitted because it appears repetitive or unsafe to copy]";

export function sanitizeReplyContextForPrompt(input: {
  reason: ReplyReason;
  replyContext: ReplyContext;
  recentMessages: StoredMessage[];
  omitAnchorBotText: boolean;
}): ReplyContext {
  return {
    triggerMessage: input.replyContext.triggerMessage,
    anchorBotMessage: sanitizeAnchorBotMessage(input),
    anchorParentMessage: input.replyContext.anchorParentMessage,
    priorContextMessages: collapseRepeatedHumanContext(
      input.replyContext.priorContextMessages
    )
  };
}

function sanitizeAnchorBotMessage(input: {
  reason: ReplyReason;
  replyContext: ReplyContext;
  recentMessages: StoredMessage[];
  omitAnchorBotText: boolean;
}): StoredMessage | null {
  const anchor = input.replyContext.anchorBotMessage;

  if (!anchor) {
    return null;
  }

  if (input.omitAnchorBotText) {
    return { ...anchor, text: UNSAFE_ANCHOR_OMISSION };
  }

  if (input.reason !== "reply_to_bot") {
    return anchor;
  }

  const recentBotTexts = input.recentMessages
    .filter((message) => message.isBot)
    .map((message) => message.text);

  if (
    hasRepeatedShortReplyAnchor({
      candidateText: anchor.text,
      recentTexts: recentBotTexts,
      minOccurrences: 2
    })
  ) {
    return { ...anchor, text: REPETITIVE_ANCHOR_OMISSION };
  }

  return anchor;
}

function collapseRepeatedHumanContext(messages: StoredMessage[]): StoredMessage[] {
  const collapsed: StoredMessage[] = [];

  for (const message of messages) {
    if (message.isBot) {
      continue;
    }

    const previous = collapsed.at(-1);

    if (previous && isNearDuplicateReplyText(previous.text, message.text)) {
      continue;
    }

    collapsed.push(message);
  }

  return collapsed;
}
