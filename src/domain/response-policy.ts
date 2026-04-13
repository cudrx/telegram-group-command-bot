export type DirectTrigger = "mention" | "reply_to_bot" | "none";

export type DetectDirectTriggerInput = {
  botUserId: number;
  botUsername: string | null;
  message: {
    text: string;
    entities?: Array<{ type: string; offset: number; length: number }>;
    replyToUserId: number | null;
  };
};

export type DecideReplyActionInput = {
  directTrigger: DirectTrigger;
};

export type DecideReplyActionResult = {
  shouldReply: boolean;
  reason: "mention" | "reply_to_bot" | "ignore";
};

export function detectDirectTrigger(
  input: DetectDirectTriggerInput
): DirectTrigger {
  if (hasMentionForBot(input)) {
    return "mention";
  }

  if (input.message.replyToUserId === input.botUserId) {
    return "reply_to_bot";
  }

  return "none";
}

export function decideReplyAction(
  input: DecideReplyActionInput
): DecideReplyActionResult {
  if (input.directTrigger === "mention") {
    return {
      shouldReply: true,
      reason: "mention"
    };
  }

  if (input.directTrigger === "reply_to_bot") {
    return {
      shouldReply: true,
      reason: "reply_to_bot"
    };
  }

  return {
    shouldReply: false,
    reason: "ignore"
  };
}

function hasMentionForBot(input: DetectDirectTriggerInput): boolean {
  if (!input.botUsername) {
    return false;
  }

  const expectedMention = `@${input.botUsername}`.toLowerCase();

  return (
    input.message.entities?.some((entity) => {
      if (entity.type !== "mention") {
        return false;
      }

      const value = input.message.text
        .slice(entity.offset, entity.offset + entity.length)
        .toLowerCase();

      return value === expectedMention;
    }) ?? false
  );
}
