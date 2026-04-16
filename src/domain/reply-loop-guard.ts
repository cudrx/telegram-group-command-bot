import type { ReplyContext, ReplyReason, StoredMessage } from "./models.js";
import {
  isNearDuplicateReplyText,
  normalizeReplyText
} from "./reply-text-similarity.js";

const MIN_POSTFLIGHT_LOOP_SIGNATURE_WORDS = 5;

export type ReplyPreflightGuardDecision =
  | { kind: "allow"; omitAnchorBotTextFromPrompt: boolean }
  | { kind: "skip"; reason: string };

export type ReplyPostflightGuardDecision =
  | { kind: "allow" }
  | { kind: "skip"; reason: string };

export function decideReplyPreflightGuard(input: {
  reason: ReplyReason;
  replyContext: ReplyContext;
  recentMessages: StoredMessage[];
  now: string;
  replyToBotLoopCooldownMs: number;
  replyToBotMinIntervalMs: number;
  lastBotMessageAt: string | null;
  enableReplyToBotCooldown: boolean;
}): ReplyPreflightGuardDecision {
  if (input.reason !== "reply_to_bot") {
    return { kind: "allow", omitAnchorBotTextFromPrompt: false };
  }

  const trigger = input.replyContext.triggerMessage;
  const anchor = input.replyContext.anchorBotMessage;

  if (!trigger || !anchor) {
    return { kind: "allow", omitAnchorBotTextFromPrompt: false };
  }

  const recentMessages = filterRecentMessagesByCooldown(
    input.recentMessages,
    input.now,
    input.replyToBotLoopCooldownMs
  );
  const recentBotMessages = recentMessages.filter((message) => message.isBot);
  const recentHumanTriggers = recentMessages.filter(
    (message) => !message.isBot && message.userId === trigger.userId
  );
  const hasRepeatedTrigger = recentHumanTriggers
    .filter((message) => message.messageId !== trigger.messageId)
    .some((message) => isNearDuplicateReplyText(message.text, trigger.text));
  const anchorRepeatsBotText = recentBotMessages
    .filter((message) => message.messageId !== anchor.messageId)
    .some((message) => isNearDuplicateReplyText(message.text, anchor.text));

  if (hasRepeatedTrigger && anchorRepeatsBotText) {
    return { kind: "allow", omitAnchorBotTextFromPrompt: true };
  }

  if (
    input.enableReplyToBotCooldown &&
    input.lastBotMessageAt !== null &&
    isWithinCooldown(input.lastBotMessageAt, trigger.createdAt, input.replyToBotMinIntervalMs)
  ) {
    return { kind: "skip", reason: "reply_to_bot_cooldown" };
  }

  return {
    kind: "allow",
    omitAnchorBotTextFromPrompt: anchorRepeatsBotText
  };
}

export function decideReplyPostflightGuard(input: {
  candidateText: string;
  recentMessages: StoredMessage[];
}): ReplyPostflightGuardDecision {
  if (!hasEnoughWordsForPostflightLoopSignature(input.candidateText)) {
    return { kind: "allow" };
  }

  const recentBotMessages = input.recentMessages.filter((message) => message.isBot);
  const duplicatesRecentBot = recentBotMessages.some((message) =>
    isNearDuplicateReplyText(message.text, input.candidateText)
  );

  if (!duplicatesRecentBot) {
    return { kind: "allow" };
  }

  return { kind: "skip", reason: "duplicate_candidate_reply" };
}

function hasEnoughWordsForPostflightLoopSignature(text: string): boolean {
  return (
    normalizeReplyText(text)
      .split(" ")
      .filter(Boolean).length >= MIN_POSTFLIGHT_LOOP_SIGNATURE_WORDS
  );
}

function filterRecentMessagesByCooldown(
  recentMessages: StoredMessage[],
  now: string,
  cooldownMs: number
): StoredMessage[] {
  if (cooldownMs <= 0) {
    return recentMessages;
  }

  const nowMs = Date.parse(now);

  if (Number.isNaN(nowMs)) {
    return recentMessages;
  }

  return recentMessages.filter((message) => {
    const createdAtMs = Date.parse(message.createdAt);

    if (Number.isNaN(createdAtMs)) {
      return true;
    }

    const ageMs = nowMs - createdAtMs;

    return ageMs >= 0 && ageMs <= cooldownMs;
  });
}

function isWithinCooldown(lastBotMessageAt: string, now: string, cooldownMs: number): boolean {
  if (cooldownMs <= 0) {
    return false;
  }

  const lastMs = Date.parse(lastBotMessageAt);
  const nowMs = Date.parse(now);

  if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) {
    return false;
  }

  return nowMs - lastMs >= 0 && nowMs - lastMs < cooldownMs;
}
