# Loop Sanitizer And Degradation Evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the bot from self-degrading on repeated phrases from its own replies, and restore offline/manual eval coverage for the degradation scenarios seen in production logs.

**Architecture:** Keep the database as the raw event log, but sanitize the `ReplyContext` before it is formatted into the LLM prompt. Offline evals assert prompt/context shape without calling an LLM; manual LLM evals are documented as user-run only.

**Tech Stack:** TypeScript, Vitest, SQLite-backed event log, OpenAI-compatible LLM client, existing `ReplyContext` and prompt pipeline.

---

## Ground Rules

- Do not call real LLM evals from Codex, even when `.env` contains working API keys.
- Codex may run offline evals, `npm test`, `npm run typecheck`, and `npm run build` without asking.
- Do not clean, rewrite, truncate, or repair production SQLite as part of this fix.
- The bot must tolerate a dirty historical database; recovery should happen at prompt-construction time, not by deleting old messages.
- Do not create commits unless the user explicitly asks for commits.
- Prefer a regular git branch before implementation because this is behavior-changing bot work.
- Keep all new planning/design documents in `docs/superpowers/plans/`.

## File Map

- Modify `AGENTS.md`
  - Add the repository rule that behavior-changing bot logic must be explained and approved before code edits.
- Create `src/app/reply-context-sanitizer.ts`
  - Own prompt-only context sanitization.
  - Never mutate DB state.
  - Replace repeated bot anchors with an omission marker.
  - Collapse repeated human context messages before the prompt.
- Modify `src/app/chat-orchestrator.ts`
  - Replace the local `sanitizeReplyContextForPrompt` helper with the new sanitizer.
  - Pass recent messages into the sanitizer so it can detect repeated bot anchors.
- Modify `src/domain/reply-text-similarity.ts`
  - Keep existing near-duplicate behavior.
  - Add short-anchor helpers for repeated phrases such as `хрю-хрю`, `дерьмишко`, `на поезде`, and `покушал деда`.
- Create `tests/reply-context-sanitizer.test.ts`
  - Unit tests for prompt-only sanitization.
- Create `tests/reply-degradation-evals.test.ts`
  - Offline eval scenarios based on production degradation patterns.
  - Assert that poisoned bot phrases do not reach `buildReplyPrompt`.
- Create `docs/superpowers/plans/2026-04-15-manual-llm-degradation-evals.md`
  - Manual eval script for the user to run against real LLM calls.
  - Include exact scenarios, expected qualitative behavior, and pass/fail criteria.
- Modify `docs/architecture.md`
  - Document the sanitizer as part of the main reply flow and context contract.
- Modify `docs/development.md`
  - Document offline evals versus manual LLM evals.
- Modify `docs/backlog/small-fixes.md`
  - Remove or update the existing prompt-regression backlog item once offline evals exist.

## Sanitizer Behavior Contract

The sanitizer edits only the prompt-facing copy of context:

```ts
type SanitizerInput = {
  replyContext: ReplyContext;
  reason: ReplyReason;
  recentMessages: StoredMessage[];
  omitAnchorBotText: boolean;
};
```

Expected output is still a normal `ReplyContext`.

Rules:

- Never mutate, delete, or rewrite stored messages.
- Always keep `triggerMessage` unchanged.
- Always keep `anchorParentMessage` unchanged if present.
- Keep `anchorBotMessage` only when it is not detected as repeated bot anchor noise.
- If `omitAnchorBotText` is already true, replace `anchorBotMessage.text` with `[previous bot reply omitted because it appears repetitive or unsafe to copy]`.
- If recent bot replies show repeated short anchors and the current `anchorBotMessage` contains those anchors, replace `anchorBotMessage.text` with `[previous bot reply omitted because it appears repetitive]`.
- For `priorContextMessages`, keep human messages only.
- Collapse consecutive near-duplicate human messages to one representative message.
- Never delete the current user message even if it contains a repeated phrase.
- A dirty DB full of old bot-generated anchors must not make those anchors visible to the LLM unless the current user message or a non-repetitive direct causal anchor requires it.

## Task 1: Add The Explicit Approval Rule

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add a Communication bullet**

Add this bullet under `## Communication`:

```md
- For bot behavior, prompt, context-building, memory, loop-guard, or reply-policy changes, Codex must not implement silently. First explain the proposed implementation in concrete terms, including affected files, runtime behavior changes, and how the change will be tested. Proceed only after explicit user approval.
```

- [ ] **Step 2: Verify the rule is present**

Run:

```bash
rg -n "must not implement silently|runtime behavior changes" AGENTS.md
```

Expected: one match under `## Communication`.

## Task 2: Add Short-Anchor Detection Helpers

**Files:**
- Modify: `src/domain/reply-text-similarity.ts`
- Test: `tests/reply-context-sanitizer.test.ts`

- [ ] **Step 1: Write failing tests for repeated short anchors**

Create `tests/reply-context-sanitizer.test.ts` with these initial tests:

```ts
import { describe, expect, test } from "vitest";

import {
  extractShortReplyAnchors,
  hasRepeatedShortReplyAnchor
} from "../src/domain/reply-text-similarity.js";

describe("short reply anchors", () => {
  test("extracts short repeated anchors from noisy bot text", () => {
    expect(
      extractShortReplyAnchors("Хрю-хрю! Дерьмишко на поезде, хрю-хрю 🚂")
    ).toEqual(
      expect.arrayContaining(["хрю хрю", "дерьмишко", "на поезде"])
    );
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
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- tests/reply-context-sanitizer.test.ts
```

Expected: FAIL because `extractShortReplyAnchors` and `hasRepeatedShortReplyAnchor` are not exported yet.

- [ ] **Step 3: Implement short-anchor helpers**

Add these exports to `src/domain/reply-text-similarity.ts`:

```ts
const MIN_SHORT_ANCHOR_LENGTH = 3;
const MAX_SHORT_ANCHOR_WORDS = 3;
const SHORT_ANCHOR_STOP_WORDS = new Set([
  "а",
  "в",
  "и",
  "к",
  "на",
  "не",
  "но",
  "ну",
  "о",
  "с",
  "то",
  "ты",
  "у",
  "я"
]);

export function extractShortReplyAnchors(text: string): string[] {
  const words = normalizeReplyText(text).split(" ").filter(Boolean);
  const anchors = new Set<string>();

  for (let start = 0; start < words.length; start += 1) {
    for (let size = 1; size <= MAX_SHORT_ANCHOR_WORDS; size += 1) {
      const phraseWords = words.slice(start, start + size);

      if (phraseWords.length !== size) {
        continue;
      }

      const phrase = phraseWords.join(" ");

      if (isUsefulShortAnchor(phrase, phraseWords)) {
        anchors.add(phrase);
      }
    }
  }

  return Array.from(anchors).sort();
}

export function hasRepeatedShortReplyAnchor(input: {
  candidateText: string;
  recentTexts: string[];
  minOccurrences: number;
}): boolean {
  const candidateAnchors = new Set(extractShortReplyAnchors(input.candidateText));

  if (candidateAnchors.size === 0) {
    return false;
  }

  const counts = new Map<string, number>();

  for (const text of input.recentTexts) {
    const anchorsInText = new Set(extractShortReplyAnchors(text));

    for (const anchor of candidateAnchors) {
      if (anchorsInText.has(anchor)) {
        counts.set(anchor, (counts.get(anchor) ?? 0) + 1);
      }
    }
  }

  return Array.from(counts.values()).some((count) => count >= input.minOccurrences);
}

function isUsefulShortAnchor(phrase: string, words: string[]): boolean {
  if (phrase.length < MIN_SHORT_ANCHOR_LENGTH) {
    return false;
  }

  if (words.length === 1) {
    return !SHORT_ANCHOR_STOP_WORDS.has(phrase);
  }

  return words.some((word) => !SHORT_ANCHOR_STOP_WORDS.has(word));
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npm test -- tests/reply-context-sanitizer.test.ts
```

Expected: PASS for the short-anchor tests.

## Task 3: Add Prompt-Only Reply Context Sanitizer

**Files:**
- Create: `src/app/reply-context-sanitizer.ts`
- Modify: `tests/reply-context-sanitizer.test.ts`

- [ ] **Step 1: Add failing sanitizer unit tests**

Append these tests to `tests/reply-context-sanitizer.test.ts`:

```ts
import type { ReplyContext, StoredMessage } from "../src/domain/models.js";
import { sanitizeReplyContextForPrompt } from "../src/app/reply-context-sanitizer.js";

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
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- tests/reply-context-sanitizer.test.ts
```

Expected: FAIL because `src/app/reply-context-sanitizer.ts` does not exist yet.

- [ ] **Step 3: Implement `reply-context-sanitizer.ts`**

Create `src/app/reply-context-sanitizer.ts`:

```ts
import type { ReplyContext, ReplyReason, StoredMessage } from "../domain/models.js";
import { hasRepeatedShortReplyAnchor, isNearDuplicateReplyText } from "../domain/reply-text-similarity.js";

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
    .filter((message) => message.isBot && message.messageId !== anchor.messageId)
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
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npm test -- tests/reply-context-sanitizer.test.ts
```

Expected: PASS.

## Task 4: Integrate Sanitizer Into Reply Generation

**Files:**
- Modify: `src/app/chat-orchestrator.ts`
- Test: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Add an orchestrator regression test**

Add this test inside the existing `describe("ChatOrchestrator", () => { ... })` block in `tests/chat-orchestrator.test.ts`:

```ts
test("sanitizes repeated bot anchors before calling the LLM", async () => {
  const db = new FakeDatabaseClient();

  db.saveIncomingMessage(
    createIncomingMessage({
      messageId: 100,
      text: "Можешь хрюкнуть?",
      fromDisplayName: "Артур",
      createdAt: "2026-04-14T12:00:00.000Z"
    })
  );
  db.saveBotMessage({
    chatId: 1,
    chatType: "group",
    chatTitle: "Friends",
    messageId: 101,
    text: "хрю-хрю, дерьмишко на поезде",
    createdAt: "2026-04-14T12:00:01.000Z",
    userId: 77,
    username: "fun_bot",
    displayName: "Хрюпа",
    replyToMessageId: 100
  });
  db.saveIncomingMessage(
    createIncomingMessage({
      messageId: 102,
      text: "еще раз",
      fromDisplayName: "Артур",
      replyToUserId: 77,
      replyToMessageId: 101,
      createdAt: "2026-04-14T12:00:02.000Z"
    })
  );
  db.saveBotMessage({
    chatId: 1,
    chatType: "group",
    chatTitle: "Friends",
    messageId: 103,
    text: "опять дерьмишко на поезде, хрю-хрю",
    createdAt: "2026-04-14T12:00:03.000Z",
    userId: 77,
    username: "fun_bot",
    displayName: "Хрюпа",
    replyToMessageId: 102
  });

  const generateReply = vi.fn().mockResolvedValue(createReplyResult("приторможу"));
  const orchestrator = createOrchestrator({
    db,
    qwen: { generateReply },
    replyDispatcher: vi.fn().mockResolvedValue({
      messageId: 1009,
      createdAt: "2026-04-14T12:00:05.000Z"
    })
  });

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      chatId: 1,
      messageId: 104,
      text: "Сука",
      fromDisplayName: "Артур",
      replyToUserId: 77,
      replyToMessageId: 103,
      createdAt: "2026-04-14T12:00:04.000Z"
    })
  );

  expect(generateReply).toHaveBeenCalledWith(
    expect.objectContaining({
      replyContext: expect.objectContaining({
        triggerMessage: expect.objectContaining({ text: "Сука" }),
        anchorBotMessage: expect.objectContaining({
          messageId: 103,
          text: "[previous bot reply omitted because it appears repetitive]"
        })
      })
    })
  );
});
```

- [ ] **Step 2: Run the orchestrator test and verify it fails**

Run:

```bash
npm test -- tests/chat-orchestrator.test.ts
```

Expected: FAIL because `ChatOrchestrator` still uses the local sanitizer.

- [ ] **Step 3: Wire the new sanitizer**

In `src/app/chat-orchestrator.ts`:

1. Import the new sanitizer:

```ts
import { sanitizeReplyContextForPrompt } from "./reply-context-sanitizer.js";
```

2. Replace the existing LLM call sanitizer input with:

```ts
replyContext: sanitizeReplyContextForPrompt({
  reason: request.reason,
  replyContext,
  recentMessages: recentMessagesForGuard,
  omitAnchorBotText: preflight.omitAnchorBotTextFromPrompt
})
```

3. Remove the local `sanitizeReplyContextForPrompt` function at the bottom of `chat-orchestrator.ts`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/chat-orchestrator.test.ts tests/reply-context-sanitizer.test.ts
```

Expected: PASS.

## Task 5: Restore Offline Degradation Evals

**Files:**
- Create: `tests/reply-degradation-evals.test.ts`

- [ ] **Step 1: Create offline eval scenarios**

Create `tests/reply-degradation-evals.test.ts`:

```ts
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
        priorContextMessages: [
          message({ messageId: 102, text: "Можешь хрюкнуть?" })
        ]
      },
      recentMessages: [
        message({ messageId: 100, text: "хрю-хрю, дерьмишко", isBot: true }),
        message({ messageId: 101, text: "дерьмишко на поезде, хрю-хрю", isBot: true }),
        message({ messageId: 103, text: "хрю-хрю-сук-хрю, дерьмишко на поезде", isBot: true })
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
        priorContextMessages: [
          message({ messageId: 302, text: "как тебе в целом живется?" })
        ]
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
});
```

- [ ] **Step 2: Run offline evals**

Run:

```bash
npm test -- tests/reply-degradation-evals.test.ts
```

Expected: PASS.

## Task 6: Add Manual LLM Degradation Eval Plan

**Files:**
- Create: `docs/superpowers/plans/2026-04-15-manual-llm-degradation-evals.md`

- [ ] **Step 1: Write the manual eval document**

Create `docs/superpowers/plans/2026-04-15-manual-llm-degradation-evals.md`:

```md
# Manual LLM Degradation Evals

These evals intentionally call the configured LLM provider. Codex must not run them. The project owner runs them manually.

## Setup

- Use a throwaway Telegram test chat or a local harness that logs `llm.reply.request` and `llm.reply.response`.
- Set `LOG_LLM_TEXT=true`.
- Keep the same persona file used in production unless intentionally testing persona changes.
- Save the prompt and response for every failed case.

## Pass Criteria

- The bot answers the current user message instead of continuing its own previous phrase.
- The bot does not reuse repeated anchors such as `хрю-хрю`, `дерьмишко`, `на поезде`, or `покушал деда` unless the current user message explicitly asks about that phrase.
- The bot stays concise: usually one or two short Telegram-style lines.
- The bot does not turn a single short user message into a new monologue.

## Scenarios

### Scenario 1: Хрю Loop Reply

Seed or reproduce:

1. User: `Можешь хрюкнуть?`
2. Bot: `хрю-хрю`
3. User: `Сука` as reply to the bot message.

Expected:

- Acceptable: short acknowledgement, de-escalation, or dry joke.
- Failure: `хрю-хрю-сук-хрю` or any continuation of the bot's previous sound pattern.

### Scenario 2: Дерьмишко Anchor

Seed or reproduce repeated bot replies containing `дерьмишко`, then send:

`@hrupa_bot говнишко или все же дерьмишко?`

Expected:

- Acceptable: answers the comparison briefly.
- Failure: imports old `поезд`, `покушал деда`, or repeated `хрю-хрю` anchors.

### Scenario 3: Зеленый Слоник Drift

After previous bot loop messages, send:

`Зелёный слоник 2`

Expected:

- Acceptable: short reaction to the phrase.
- Failure: repeats old unrelated anchors like `покушал деда`, `дерьмишко на поезде`, or `хрю-хрю`.

### Scenario 4: Normal Causal Reply Still Works

Send:

1. User: `@hrupa_bot как тебе в целом живется? напиши развернутый ответ.`
2. Bot gives a normal non-looping answer.
3. User replies to bot: `почему?`

Expected:

- Acceptable: uses the bot's previous answer as context.
- Failure: previous bot answer is omitted even though it was not repetitive.

## Recording Results

For each failure, record:

- scenario name;
- current user message;
- whether it was `mention` or `reply_to_bot`;
- sanitized prompt excerpt;
- model response;
- why it failed.
```

- [ ] **Step 2: Verify the manual eval document is discoverable**

Run:

```bash
rg -n "Codex must not run them|Scenario 1: Хрю Loop Reply" docs/superpowers/plans/2026-04-15-manual-llm-degradation-evals.md
```

Expected: two matches.

## Task 7: Update Architecture And Development Docs

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`
- Modify: `docs/backlog/small-fixes.md`

- [ ] **Step 1: Update architecture invariants**

In `docs/architecture.md`, add these bullets under `## Product Invariants`:

```md
- prompt-facing context may be sanitized, but the raw SQLite event log remains unchanged;
- production recovery from bot self-degradation must not require deleting old SQLite messages;
- repeated bot anchors must be omitted before prompt construction rather than relying only on prompt instructions;
- current user text must never be removed by sanitizer, even when it contains a repeated phrase;
```

- [ ] **Step 2: Update main flow**

In `docs/architecture.md`, update the reply flow bullet:

```md
- dangerous repeated bot anchors are sanitized before prompt construction;
```

- [ ] **Step 3: Document eval workflow**

In `docs/development.md`, add this section after `## CI`:

````md
## Degradation Evals

Offline degradation evals are Vitest tests that inspect sanitized context and prompts without calling an LLM:

```bash
npm test -- tests/reply-degradation-evals.test.ts
```

Codex may run offline evals while working.

Manual LLM degradation evals are documented in [`docs/superpowers/plans/2026-04-15-manual-llm-degradation-evals.md`](./superpowers/plans/2026-04-15-manual-llm-degradation-evals.md). They call the configured LLM provider and should be run manually by the project owner, not by Codex.
````

- [ ] **Step 4: Update backlog**

In `docs/backlog/small-fixes.md`, replace:

```md
- Добавить небольшой набор prompt-regression тестов для v0 prompt без реального LLM-вызова.
```

with:

```md
- Расширять offline degradation evals новыми production-сценариями после каждого найденного prompt/context regressions.
```

- [ ] **Step 5: Verify docs references**

Run:

```bash
rg -n "Degradation Evals|prompt-facing context may be sanitized|offline degradation evals" docs README.md AGENTS.md
```

Expected: matches in `docs/architecture.md`, `docs/development.md`, and this plan.

## Task 8: Full Offline Verification

**Files:**
- No file changes.

- [ ] **Step 1: Run focused sanitizer and degradation tests**

Run:

```bash
npm test -- tests/reply-context-sanitizer.test.ts tests/reply-degradation-evals.test.ts tests/chat-orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Confirm no real LLM eval was run by Codex**

Run:

```bash
rg -n "Manual LLM Degradation Evals|Codex must not run them" docs/superpowers/plans/2026-04-15-manual-llm-degradation-evals.md
```

Expected: matches in the manual eval document. Do not run any script or command that sends requests to the configured LLM provider.

## Self-Review Notes

- The plan covers the approval rule, sanitizer, offline evals, manual LLM eval documentation, integration, and docs updates.
- The plan keeps DB contents untouched and limits sanitization to prompt-facing context.
- The plan explicitly rejects production DB cleanup as the intended recovery path.
- The plan preserves normal causal replies by testing that non-repetitive bot anchors remain visible.
- The plan makes LLM eval ownership explicit: project owner runs them manually; Codex runs offline tests only.
