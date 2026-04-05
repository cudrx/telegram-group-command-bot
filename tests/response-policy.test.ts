import { describe, expect, test } from "vitest";

import { decideReplyAction, detectDirectTrigger } from "../src/domain/response-policy.js";

describe("detectDirectTrigger", () => {
  test("returns mention when bot username is present in message entities", () => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: "fun_bot",
      message: {
        text: "эй, @fun_bot, расскажи что-нибудь",
        entities: [{ type: "mention", offset: 4, length: 8 }],
        replyToUserId: null
      }
    });

    expect(trigger).toBe("mention");
  });

  test("returns reply_to_bot when message is a reply to bot", () => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: "fun_bot",
      message: {
        text: "это было сильно",
        entities: [],
        replyToUserId: 77
      }
    });

    expect(trigger).toBe("reply_to_bot");
  });

  test("returns none for ordinary messages", () => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: "fun_bot",
      message: {
        text: "обычное сообщение без обращения",
        entities: [],
        replyToUserId: null
      }
    });

    expect(trigger).toBe("none");
  });
});

describe("decideReplyAction", () => {
  test("always replies to direct mentions", () => {
    const decision = decideReplyAction({
      directTrigger: "mention",
      allowDirectMessages: false,
      allowInterjections: true,
      interjectProbability: 0.12,
      randomValue: 0.99,
      cooldownMs: 1_800_000,
      lastBotMessageAt: null,
      now: "2026-04-03T12:00:00.000Z"
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: "mention"
    });
  });

  test("always replies to ordinary direct messages in private chat", () => {
    const decision = decideReplyAction({
      directTrigger: "none",
      allowDirectMessages: true,
      allowInterjections: false,
      interjectProbability: 0.12,
      randomValue: 0.99,
      cooldownMs: 1_800_000,
      lastBotMessageAt: null,
      now: "2026-04-03T12:00:00.000Z"
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: "direct_message"
    });
  });

  test("allows random interjection when cooldown has passed and probability hits", () => {
    const decision = decideReplyAction({
      directTrigger: "none",
      allowDirectMessages: false,
      allowInterjections: true,
      interjectProbability: 0.12,
      randomValue: 0.05,
      cooldownMs: 1_800_000,
      lastBotMessageAt: "2026-04-03T11:00:00.000Z",
      now: "2026-04-03T12:00:00.000Z"
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: "interjection"
    });
  });

  test("stays silent when direct trigger is absent and random roll misses", () => {
    const decision = decideReplyAction({
      directTrigger: "none",
      allowDirectMessages: false,
      allowInterjections: true,
      interjectProbability: 0.12,
      randomValue: 0.8,
      cooldownMs: 1_800_000,
      lastBotMessageAt: null,
      now: "2026-04-03T12:00:00.000Z"
    });

    expect(decision).toEqual({
      shouldReply: false,
      reason: "ignore"
    });
  });
});
