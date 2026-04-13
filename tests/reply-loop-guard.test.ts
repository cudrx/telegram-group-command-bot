import { describe, expect, test } from "vitest";

import type { ReplyContext, ReplyReason, StoredMessage } from "../src/domain/models.js";
import {
  decideReplyPostflightGuard,
  decideReplyPreflightGuard
} from "../src/domain/reply-loop-guard.js";

const loopBreakerText = "я зациклился, приторможу";
const now = "2026-04-13T09:00:10.000Z";

function storedMessage(overrides: Partial<StoredMessage>): StoredMessage {
  return {
    chatId: 1,
    messageId: 1,
    userId: 42,
    senderDisplayName: "Tom",
    text: "hello",
    createdAt: "2026-04-13T09:00:00.000Z",
    isBot: false,
    replyToMessageId: null,
    ...overrides
  };
}

function replyContext(overrides: Partial<ReplyContext> = {}): ReplyContext {
  const anchorBotMessage = storedMessage({
    messageId: 20,
    userId: null,
    senderDisplayName: "Khryupa",
    text: "ну ты и говно, да\nа я тут просто сижу, как винтик в дыре",
    isBot: true
  });

  const triggerMessage = storedMessage({
    messageId: 21,
    text: "Ты анальная пробка?",
    createdAt: now,
    replyToMessageId: anchorBotMessage.messageId
  });

  return {
    triggerMessage,
    anchorBotMessage,
    anchorParentMessage: null,
    priorContextMessages: [],
    ...overrides
  };
}

function decidePreflight(overrides: {
  reason?: ReplyReason;
  replyContext?: ReplyContext;
  recentMessages?: StoredMessage[];
  now?: string;
  replyToBotLoopCooldownMs?: number;
  replyToBotMinIntervalMs?: number;
  lastBotMessageAt?: string | null;
  enableReplyToBotCooldown?: boolean;
  loopBreakerText?: string;
} = {}) {
  return decideReplyPreflightGuard({
    reason: "reply_to_bot",
    replyContext: replyContext(),
    recentMessages: [],
    now,
    replyToBotLoopCooldownMs: 15_000,
    replyToBotMinIntervalMs: 2500,
    lastBotMessageAt: null,
    enableReplyToBotCooldown: true,
    loopBreakerText,
    ...overrides
  });
}

describe("reply loop guard", () => {
  test("returns a deterministic loop breaker for repeated reply-to-bot chains", () => {
    const context = replyContext();

    expect(
      decidePreflight({
        replyContext: context,
        recentMessages: [
          storedMessage({
            messageId: 18,
            text: "ты анальная пробка",
            userId: context.triggerMessage?.userId ?? null,
            createdAt: "2026-04-13T09:00:04.000Z"
          }),
          storedMessage({
            messageId: 19,
            text: "ну ты и говно да а я тут просто сижу как винтик в дыре",
            isBot: true,
            userId: null,
            createdAt: "2026-04-13T09:00:05.000Z"
          })
        ]
      })
    ).toEqual({
      kind: "deterministic_reply",
      text: loopBreakerText,
      model: "deterministic-loop-guard",
      omitAnchorBotTextFromPrompt: true,
      reason: "repeated_reply_to_bot_chain"
    });
  });

  test("skips a repeated reply-to-bot chain after a loop breaker was already sent", () => {
    const context = replyContext();

    expect(
      decidePreflight({
        replyContext: context,
        recentMessages: [
          storedMessage({
            messageId: 18,
            text: "ты анальная пробка",
            userId: context.triggerMessage?.userId ?? null,
            createdAt: "2026-04-13T09:00:04.000Z"
          }),
          storedMessage({
            messageId: 19,
            text: context.anchorBotMessage!.text,
            isBot: true,
            userId: null,
            createdAt: "2026-04-13T09:00:05.000Z"
          }),
          storedMessage({
            messageId: 20,
            text: loopBreakerText,
            isBot: true,
            userId: null,
            createdAt: "2026-04-13T09:00:06.000Z"
          })
        ]
      })
    ).toEqual({ kind: "skip", reason: "recent_loop_breaker_already_sent" });
  });

  test("allows a normal one-off reply-to-bot question", () => {
    expect(
      decidePreflight({
        recentMessages: [
          storedMessage({
            messageId: 19,
            text: "совсем другой бот ответ",
            isBot: true,
            userId: null
          })
        ]
      })
    ).toEqual({ kind: "allow", omitAnchorBotTextFromPrompt: false });
  });

  test("skips a non-looping reply-to-bot message inside the group cooldown", () => {
    expect(
      decidePreflight({
        lastBotMessageAt: "2026-04-13T09:00:08.000Z",
        replyToBotMinIntervalMs: 2500,
        enableReplyToBotCooldown: true
      })
    ).toEqual({ kind: "skip", reason: "reply_to_bot_cooldown" });
  });

  test("allows private reply-to-bot messages when cooldown is disabled", () => {
    expect(
      decidePreflight({
        lastBotMessageAt: "2026-04-13T09:00:08.000Z",
        replyToBotMinIntervalMs: 2500,
        enableReplyToBotCooldown: false
      })
    ).toEqual({ kind: "allow", omitAnchorBotTextFromPrompt: false });
  });

  test("allows but omits a repeated anchor bot text from the prompt", () => {
    const context = replyContext();

    expect(
      decidePreflight({
        replyContext: context,
        recentMessages: [
          storedMessage({
            messageId: 19,
            text: context.anchorBotMessage!.text,
            isBot: true,
            userId: null,
            createdAt: "2026-04-13T09:00:05.000Z"
          })
        ]
      })
    ).toEqual({ kind: "allow", omitAnchorBotTextFromPrompt: true });
  });

  test("keeps messages with unparseable timestamps in the loop cooldown window", () => {
    const context = replyContext();

    expect(
      decidePreflight({
        replyContext: context,
        recentMessages: [
          storedMessage({
            messageId: 18,
            text: "ты анальная пробка",
            userId: context.triggerMessage?.userId ?? null,
            createdAt: "not-a-date"
          }),
          storedMessage({
            messageId: 19,
            text: context.anchorBotMessage!.text,
            isBot: true,
            userId: null,
            createdAt: "also-not-a-date"
          })
        ],
        replyToBotLoopCooldownMs: 1
      })
    ).toMatchObject({
      kind: "deterministic_reply",
      omitAnchorBotTextFromPrompt: true
    });
  });

  test("replaces a generated candidate reply that near-duplicates a recent bot reply", () => {
    expect(
      decideReplyPostflightGuard({
        candidateText: "ну ты и говно да а я просто сижу как винтик в дыре",
        recentMessages: [
          storedMessage({
            messageId: 19,
            text: "ну ты и говно, да\nа я тут просто сижу, как винтик в дыре",
            isBot: true,
            userId: null
          })
        ],
        loopBreakerText
      })
    ).toEqual({
      kind: "replace",
      text: loopBreakerText,
      model: "deterministic-loop-guard",
      reason: "duplicate_candidate_reply"
    });
  });

  test("allows a generated candidate reply that is distinct from recent bot replies", () => {
    expect(
      decideReplyPostflightGuard({
        candidateText: "давай лучше сменим тему",
        recentMessages: [
          storedMessage({
            messageId: 19,
            text: "ну ты и говно, да\nа я тут просто сижу, как винтик в дыре",
            isBot: true,
            userId: null
          })
        ],
        loopBreakerText
      })
    ).toEqual({ kind: "allow" });
  });

  test("allows exact duplicate generated replies when they are too short to be a loop signature", () => {
    expect(
      decideReplyPostflightGuard({
        candidateText: "да",
        recentMessages: [
          storedMessage({
            messageId: 19,
            text: "да",
            isBot: true,
            userId: null
          })
        ],
        loopBreakerText
      })
    ).toEqual({ kind: "allow" });
  });
});
