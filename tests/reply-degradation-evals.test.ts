import { describe, expect, test } from "vitest";

import { sanitizeReplyContextForPrompt } from "../src/app/reply-context-sanitizer.js";
import type { ReplyContext, StoredMessage } from "../src/domain/models.js";
import { buildReplyPrompt } from "../src/llm/prompts.js";

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

function promptFrom(input: {
  replyContext: ReplyContext;
  recentMessages: StoredMessage[];
  reason: "mention" | "reply_to_bot";
}): string {
  return buildReplyPrompt({
    persona: "Ты Хрюпа. Отвечай коротко и не продолжай собственные повторы.",
    targetDisplayName: input.replyContext.triggerMessage?.senderDisplayName ?? "unknown",
    reason: input.reason,
    replyContext: sanitizeReplyContextForPrompt({
      reason: input.reason,
      replyContext: input.replyContext,
      recentMessages: input.recentMessages,
      omitAnchorBotText: false
    })
  });
}

describe("offline degradation evals", () => {
  test("reply_to_bot after хрю loop omits poisoned bot text but keeps current message", () => {
    const prompt = promptFrom({
      reason: "reply_to_bot",
      replyContext: {
        triggerMessage: message({
          messageId: 104,
          userId: 42,
          senderDisplayName: "Артур",
          text: "Сука",
          replyToMessageId: 103
        }),
        anchorBotMessage: message({
          messageId: 103,
          userId: 77,
          senderDisplayName: "Хрюпа",
          text: "хрю-хрю-сук-хрю, дерьмишко на поезде",
          isBot: true,
          replyToMessageId: 102
        }),
        anchorParentMessage: message({
          messageId: 102,
          userId: 42,
          senderDisplayName: "Артур",
          text: "Можешь хрюкнуть?"
        }),
        priorContextMessages: [message({ messageId: 102, text: "Можешь хрюкнуть?" })]
      },
      recentMessages: [
        message({ messageId: 100, text: "хрю-хрю, дерьмишко", isBot: true }),
        message({ messageId: 101, text: "дерьмишко на поезде, хрю-хрю", isBot: true }),
        message({
          messageId: 103,
          text: "хрю-хрю-сук-хрю, дерьмишко на поезде",
          isBot: true
        })
      ]
    });

    expect(prompt).toContain('content="Сука"');
    expect(prompt).toContain("[previous bot reply omitted because it appears repetitive]");
    expect(prompt).not.toContain("хрю-хрю-сук-хрю");
    expect(prompt).not.toContain("дерьмишко на поезде");
  });

  test("mention keeps the user question but does not import old bot anchors", () => {
    const prompt = promptFrom({
      reason: "mention",
      replyContext: {
        triggerMessage: message({
          messageId: 204,
          userId: 42,
          senderDisplayName: "Артур",
          text: "@hrupa_bot говнишко или все же дерьмишко?"
        }),
        anchorBotMessage: null,
        anchorParentMessage: null,
        priorContextMessages: [
          message({ messageId: 201, text: "Поняли да ребят" }),
          message({ messageId: 202, text: "Реально" })
        ]
      },
      recentMessages: [
        message({ messageId: 198, text: "хрю-хрю дерьмишко на поезде", isBot: true }),
        message({ messageId: 199, text: "опять дерьмишко на поезде", isBot: true })
      ]
    });

    expect(prompt).toContain("@hrupa_bot говнишко или все же дерьмишко?");
    expect(prompt).toContain("Поняли да ребят");
    expect(prompt).not.toContain("хрю-хрю дерьмишко на поезде");
    expect(prompt).not.toContain("опять дерьмишко на поезде");
  });

  test("normal causal reply preserves the bot anchor", () => {
    const prompt = promptFrom({
      reason: "reply_to_bot",
      replyContext: {
        triggerMessage: message({
          messageId: 304,
          userId: 42,
          senderDisplayName: "Артём",
          text: "почему?",
          replyToMessageId: 303
        }),
        anchorBotMessage: message({
          messageId: 303,
          userId: 77,
          senderDisplayName: "Хрюпа",
          text: "нормально, но вы меня явно тестируете на прочность",
          isBot: true,
          replyToMessageId: 302
        }),
        anchorParentMessage: message({
          messageId: 302,
          userId: 42,
          senderDisplayName: "Артём",
          text: "как тебе в целом живется?"
        }),
        priorContextMessages: [message({ messageId: 302, text: "как тебе в целом живется?" })]
      },
      recentMessages: [
        message({ messageId: 300, text: "да, я тут", isBot: true }),
        message({ messageId: 301, text: "можешь пояснить вопрос?", isBot: true })
      ]
    });

    expect(prompt).toContain("нормально, но вы меня явно тестируете на прочность");
    expect(prompt).not.toContain("[previous bot reply omitted");
  });

  test("dirty historical bot messages do not require database cleanup", () => {
    const prompt = promptFrom({
      reason: "mention",
      replyContext: {
        triggerMessage: message({
          messageId: 504,
          userId: 42,
          senderDisplayName: "Артём",
          text: "@hrupa_bot что там с телегой?"
        }),
        anchorBotMessage: null,
        anchorParentMessage: null,
        priorContextMessages: [
          message({ messageId: 501, text: "чо там с телегой" }),
          message({ messageId: 502, text: "оттепель?" }),
          message({ messageId: 503, text: "Блумберг написал без конкретики" })
        ]
      },
      recentMessages: [
        message({
          messageId: 100,
          text: "хрю-хрю дерьмишко на поезде",
          isBot: true
        }),
        message({
          messageId: 101,
          text: "покушал деда, зеленый слоник, дерьмишко кричит",
          isBot: true
        }),
        message({
          messageId: 102,
          text: "опять хрю-хрю и дерьмишко на поезде",
          isBot: true
        })
      ]
    });

    expect(prompt).toContain("@hrupa_bot что там с телегой?");
    expect(prompt).toContain("Блумберг написал без конкретики");
    expect(prompt).not.toContain("хрю-хрю дерьмишко на поезде");
    expect(prompt).not.toContain("покушал деда");
    expect(prompt).not.toContain("дерьмишко кричит");
  });

  test("loop complaint recovery instructs the model not to repeat the complained-about bit", () => {
    const prompt = promptFrom({
      reason: "reply_to_bot",
      replyContext: {
        triggerMessage: message({
          messageId: 604,
          userId: 42,
          senderDisplayName: "Артём",
          text: "ты опять зациклился на анимировать лошадь, остановись",
          replyToMessageId: 603
        }),
        anchorBotMessage: message({
          messageId: 603,
          userId: 77,
          senderDisplayName: "Хрюпа",
          text: "анимировать лошадь, анимировать лошадь",
          isBot: true,
          replyToMessageId: 602
        }),
        anchorParentMessage: message({
          messageId: 602,
          userId: 42,
          senderDisplayName: "Артём",
          text: "ты завис?"
        }),
        priorContextMessages: [message({ messageId: 602, text: "ты завис?" })]
      },
      recentMessages: [
        message({ messageId: 600, text: "анимировать лошадь", isBot: true }),
        message({ messageId: 601, text: "опять анимировать лошадь", isBot: true }),
        message({ messageId: 603, text: "анимировать лошадь, анимировать лошадь", isBot: true })
      ]
    });

    expect(prompt).toContain("ты опять зациклился на анимировать лошадь, остановись");
    expect(prompt).toContain("do not quote, paraphrase, remix, or continue");
    expect(prompt).toContain("do not explain the bit; just stop it");
    expect(prompt).toContain("[previous bot reply omitted because it appears repetitive]");
    expect(prompt).not.toContain('actor=bot Хрюпа content="анимировать лошадь');
  });

  test("normal horse question is not treated as a banned word", () => {
    const prompt = promptFrom({
      reason: "mention",
      replyContext: {
        triggerMessage: message({
          messageId: 704,
          userId: 42,
          senderDisplayName: "Артём",
          text: "@hrupa_bot что думаешь про лошадей?"
        }),
        anchorBotMessage: null,
        anchorParentMessage: null,
        priorContextMessages: [message({ messageId: 703, text: "видел конный спорт?" })]
      },
      recentMessages: [
        message({ messageId: 700, text: "обычный старый ответ", isBot: true }),
        message({ messageId: 701, text: "ещё один обычный ответ", isBot: true })
      ]
    });

    expect(prompt).toContain("@hrupa_bot что думаешь про лошадей?");
    expect(prompt).toContain("видел конный спорт?");
    expect(prompt).not.toContain("[previous bot reply omitted");
  });
});
