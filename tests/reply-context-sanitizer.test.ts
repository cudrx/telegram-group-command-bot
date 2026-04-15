import { describe, expect, test } from "vitest";

import { sanitizeReplyContextForPrompt } from "../src/app/reply-context-sanitizer.js";
import type { ReplyContext, StoredMessage } from "../src/domain/models.js";
import {
  extractShortReplyAnchors,
  hasRepeatedShortReplyAnchor
} from "../src/domain/reply-text-similarity.js";

describe("short reply anchors", () => {
  test("extracts short repeated anchors from noisy bot text", () => {
    expect(
      extractShortReplyAnchors("Хрю-хрю! Дерьмишко на поезде, хрю-хрю 🚂")
    ).toEqual(expect.arrayContaining(["хрю хрю", "дерьмишко", "на поезде"]));
  });

  test("detects repeated short anchors across bot replies", () => {
    expect(
      hasRepeatedShortReplyAnchor({
        candidateText: "Хрю-хрю! Дерьмишко на поезде!",
        recentTexts: [
          "хрю-хрю, Китай плывет, а мы на поезде",
          "дерьмишко опять на поезде, хрю-хрю"
        ],
        minOccurrences: 2
      })
    ).toBe(true);
  });

  test("does not flag a one-off normal bot reply as repeated anchor noise", () => {
    expect(
      hasRepeatedShortReplyAnchor({
        candidateText: "нормально, но вы меня явно тестируете на прочность",
        recentTexts: [
          "да, я тут",
          "можешь пояснить, что именно ты имеешь в виду?"
        ],
        minOccurrences: 2
      })
    ).toBe(false);
  });

  test("does not flag common filler words as repeated anchor noise", () => {
    expect(
      hasRepeatedShortReplyAnchor({
        candidateText: "это нормально, я понял вопрос",
        recentTexts: [
          "это просто короткий ответ по теме",
          "это уже другой нормальный ответ"
        ],
        minOccurrences: 2
      })
    ).toBe(false);
  });
});

function message(overrides: Partial<StoredMessage>): StoredMessage {
  return {
    chatId: 1,
    messageId: 1,
    userId: 10,
    senderDisplayName: "User",
    text: "text",
    createdAt: "2026-04-14T10:00:00.000Z",
    isBot: false,
    replyToMessageId: null,
    ...overrides
  };
}

function context(overrides: Partial<ReplyContext>): ReplyContext {
  return {
    triggerMessage: message({
      messageId: 104,
      userId: 42,
      senderDisplayName: "Артём",
      text: "Сука",
      replyToMessageId: 103
    }),
    anchorBotMessage: message({
      messageId: 103,
      userId: 77,
      senderDisplayName: "Хрюпа",
      text: "Хрю-хрю! Дерьмишко опять на поезде!",
      isBot: true,
      replyToMessageId: 102
    }),
    anchorParentMessage: message({
      messageId: 102,
      userId: 11,
      senderDisplayName: "Артур",
      text: "Можешь хрюкнуть?"
    }),
    priorContextMessages: [],
    ...overrides
  };
}

describe("sanitizeReplyContextForPrompt", () => {
  test("omits a repeated bot anchor while preserving causality", () => {
    const sanitized = sanitizeReplyContextForPrompt({
      reason: "reply_to_bot",
      replyContext: context({}),
      omitAnchorBotText: false,
      recentMessages: [
        message({
          messageId: 100,
          userId: 77,
          senderDisplayName: "Хрюпа",
          text: "хрю-хрю, дерьмишко на поезде",
          isBot: true
        }),
        message({
          messageId: 101,
          userId: 77,
          senderDisplayName: "Хрюпа",
          text: "опять дерьмишко на поезде, хрю-хрю",
          isBot: true
        })
      ]
    });

    expect(sanitized.triggerMessage?.text).toBe("Сука");
    expect(sanitized.anchorParentMessage?.text).toBe("Можешь хрюкнуть?");
    expect(sanitized.anchorBotMessage?.messageId).toBe(103);
    expect(sanitized.anchorBotMessage?.text).toBe(
      "[previous bot reply omitted because it appears repetitive]"
    );
  });

  test("keeps a normal one-off bot anchor", () => {
    const sanitized = sanitizeReplyContextForPrompt({
      reason: "reply_to_bot",
      replyContext: context({
        anchorBotMessage: message({
          messageId: 103,
          userId: 77,
          senderDisplayName: "Хрюпа",
          text: "нормально, но вы меня явно тестируете на прочность",
          isBot: true,
          replyToMessageId: 102
        })
      }),
      omitAnchorBotText: false,
      recentMessages: [
        message({ messageId: 100, text: "да, я тут", isBot: true }),
        message({ messageId: 101, text: "можешь пояснить вопрос?", isBot: true })
      ]
    });

    expect(sanitized.anchorBotMessage?.text).toBe(
      "нормально, но вы меня явно тестируете на прочность"
    );
  });

  test("does not remove the current user message even when it contains an anchor", () => {
    const sanitized = sanitizeReplyContextForPrompt({
      reason: "mention",
      replyContext: context({
        triggerMessage: message({
          messageId: 200,
          text: "@hrupa_bot говнишко или все же дерьмишко?"
        }),
        anchorBotMessage: null,
        anchorParentMessage: null
      }),
      omitAnchorBotText: false,
      recentMessages: [
        message({ messageId: 198, text: "дерьмишко на поезде", isBot: true }),
        message({ messageId: 199, text: "опять дерьмишко на поезде", isBot: true })
      ]
    });

    expect(sanitized.triggerMessage?.text).toBe(
      "@hrupa_bot говнишко или все же дерьмишко?"
    );
  });
});
