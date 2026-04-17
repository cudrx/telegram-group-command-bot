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

  test("returns none when message is a reply to bot without mention", () => {
    const trigger = detectDirectTrigger({
      botUserId: 77,
      botUsername: "fun_bot",
      message: {
        text: "это было сильно",
        entities: [],
        replyToUserId: 77
      }
    });

    expect(trigger).toBe("none");
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
      directTrigger: "mention"
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: "mention"
    });
  });

  test("ignores messages without a mention trigger", () => {
    const decision = decideReplyAction({
      directTrigger: "none"
    });

    expect(decision).toEqual({
      shouldReply: false,
      reason: "ignore"
    });
  });
});
