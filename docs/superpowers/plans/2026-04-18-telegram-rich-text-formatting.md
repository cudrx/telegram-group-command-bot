# Telegram Rich Text Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram bot replies visually structured with Telegram HTML formatting while protecting Telegram sends from unsupported or broken HTML.

**Architecture:** The LLM prompt will explicitly request a small Telegram HTML-compatible formatting subset. A focused app-layer formatter will normalize bullets, trim excessive whitespace, preserve only safe Telegram tags, escape raw text, and repair unclosed tags before the reply is sent and saved. The Telegram transport will send replies with `parse_mode: "HTML"`.

**Tech Stack:** Node.js, TypeScript, grammY, Vitest, existing `ChatOrchestrator` reply pipeline, Telegram Bot API HTML parse mode.

---

## Scope And Constraints

- Keep this change local to reply formatting, prompt guidance, and Telegram send options.
- Do not change command routing, context building, storage schema, LLM provider code, or intent semantics.
- Do not add MarkdownV2 support.
- Do not add a heavy HTML parser dependency; the formatter only needs to handle a tiny allowlist.
- Do not create git commits during implementation unless the user explicitly asks.
- Keep eval fixtures semantic unless a prompt change requires new semantic checks.

## File Map

- Create: `src/app/telegram-html.ts`
  - Owns Telegram-safe reply formatting.
  - Exports `formatTelegramHtmlReply(text: string): string`.
- Create: `tests/telegram-html.test.ts`
  - Unit tests for allowed tags, escaping, unsupported tags, bullet normalization, whitespace trimming, and broken tag repair.
- Modify: `src/app/chat-orchestrator.ts`
  - Applies `formatTelegramHtmlReply()` to every reply result before dispatch and database save.
- Modify: `tests/chat-orchestrator.test.ts`
  - Verifies dispatched and saved text is formatted/sanitized.
- Modify: `src/app.ts`
  - Sends Telegram messages with `parse_mode: "HTML"`.
- Modify: `tests/app.test.ts`
  - Verifies the transport passes Telegram HTML parse mode.
- Modify: `src/llm/prompts.ts`
  - Adds Telegram HTML formatting rules and per-intent response shapes.
- Modify: `tests/llm-prompts.test.ts`
  - Verifies prompt text contains the HTML formatting contract.
- Review only: `scripts/intent-eval-fixtures.ts`
  - Keep unchanged unless semantic rubrics become incompatible.
- Review after implementation: `README.md`, `docs/architecture.md`, `docs/development.md`
  - Update only if the final behavior should be durable user/developer documentation.

---

### Task 1: Add Telegram HTML Formatter

**Files:**
- Create: `src/app/telegram-html.ts`
- Create: `tests/telegram-html.test.ts`

- [ ] **Step 1: Write failing formatter tests**

Create `tests/telegram-html.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { formatTelegramHtmlReply } from "../src/app/telegram-html.js";

describe("formatTelegramHtmlReply", () => {
  test("preserves safe Telegram HTML tags and escapes raw text", () => {
    const formatted = formatTelegramHtmlReply(
      "<b>Итог</b>\n\n2 < 3, но 5 > 4 & это ок"
    );

    expect(formatted).toBe("<b>Итог</b>\n\n2 &lt; 3, но 5 &gt; 4 &amp; это ок");
  });

  test("removes unsupported tags while preserving their text content", () => {
    const formatted = formatTelegramHtmlReply(
      '<a href="https://example.com">ссылка</a> <u>подчеркнуто</u> <script>alert</script>'
    );

    expect(formatted).toBe("ссылка подчеркнуто alert");
  });

  test("normalizes markdown-like bullets and excessive blank lines", () => {
    const formatted = formatTelegramHtmlReply(
      "Коротко:\n\n\n- первый пункт\n* второй пункт\n  • третий пункт\n\n\n\nконец"
    );

    expect(formatted).toBe("Коротко:\n\n• первый пункт\n• второй пункт\n• третий пункт\n\nконец");
  });

  test("normalizes allowed tag attributes and repairs unclosed tags", () => {
    const formatted = formatTelegramHtmlReply(
      '<b class="title">Смысл\n\n<i data-x="1">важно'
    );

    expect(formatted).toBe("<b>Смысл\n\n<i>важно</i></b>");
  });

  test("closes nested tags before a mismatched parent closing tag", () => {
    const formatted = formatTelegramHtmlReply("<b>жирно <i>курсив</b> хвост</i>");

    expect(formatted).toBe("<b>жирно <i>курсив</i></b> хвост");
  });
});
```

- [ ] **Step 2: Run formatter tests and verify RED**

Run:

```bash
npm test -- tests/telegram-html.test.ts
```

Expected: FAIL because `../src/app/telegram-html.js` does not exist.

- [ ] **Step 3: Implement the formatter**

Create `src/app/telegram-html.ts`:

```ts
const ALLOWED_TAGS = new Set(["b", "i", "code"]);
const TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;

export function formatTelegramHtmlReply(text: string): string {
  return sanitizeTelegramHtml(normalizeReplyText(text));
}

function normalizeReplyText(text: string): string {
  const normalizedLines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeBulletLine(line.trimEnd()));

  return normalizedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeBulletLine(line: string): string {
  return line
    .replace(/^\s*[-*]\s+/, "• ")
    .replace(/^\s*•\s+/, "• ");
}

function sanitizeTelegramHtml(text: string): string {
  const output: string[] = [];
  const openTags: string[] = [];
  let cursor = 0;

  for (const match of text.matchAll(TAG_PATTERN)) {
    const tagToken = match[0];
    const tagStart = match.index ?? 0;

    output.push(escapeHtml(text.slice(cursor, tagStart)));
    appendSafeTag(tagToken, output, openTags);
    cursor = tagStart + tagToken.length;
  }

  output.push(escapeHtml(text.slice(cursor)));

  while (openTags.length > 0) {
    output.push(`</${openTags.pop()}>`);
  }

  return output.join("");
}

function appendSafeTag(tagToken: string, output: string[], openTags: string[]): void {
  const parsed = /^<\s*(\/?)\s*([a-zA-Z]+)(?:\s+[^>]*)?\s*>$/.exec(tagToken);

  if (!parsed) {
    return;
  }

  const [, closingSlash, rawName] = parsed;
  const tagName = rawName.toLowerCase();

  if (!ALLOWED_TAGS.has(tagName)) {
    return;
  }

  if (!closingSlash) {
    output.push(`<${tagName}>`);
    openTags.push(tagName);
    return;
  }

  closeTag(tagName, output, openTags);
}

function closeTag(tagName: string, output: string[], openTags: string[]): void {
  const existingIndex = openTags.lastIndexOf(tagName);

  if (existingIndex === -1) {
    return;
  }

  while (openTags.length > existingIndex) {
    output.push(`</${openTags.pop()}>`);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

- [ ] **Step 4: Run formatter tests and verify GREEN**

Run:

```bash
npm test -- tests/telegram-html.test.ts
```

Expected: PASS.

---

### Task 2: Format Replies Before Dispatch And Storage

**Files:**
- Modify: `src/app/chat-orchestrator.ts`
- Modify: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Write failing orchestrator test**

Add this test in `tests/chat-orchestrator.test.ts` near the existing command-mode reply tests:

```ts
  test("formats replies before dispatching and saving bot messages", async () => {
    const db = new FakeDatabaseClient();
    const generateReply = vi.fn().mockResolvedValue(
      createReplyResult("<b>Коротко</b>\n\n- пункт\n<script>alert</script>")
    );
    const replyDispatcher = vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: "2026-04-03T12:00:30.000Z"
    });
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply },
      replyDispatcher
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 2,
        text: "/summarize",
        entities: [{ type: "bot_command", offset: 0, length: 10 }]
      })
    );

    expect(replyDispatcher).toHaveBeenCalledWith({
      chatId: 1,
      replyToMessageId: 2,
      text: "<b>Коротко</b>\n\n• пункт\nalert"
    });
    expect(db.getMessageByTelegramMessageId(1, 1001)).toMatchObject({
      messageId: 1001,
      text: "<b>Коротко</b>\n\n• пункт\nalert",
      replyToMessageId: 2,
      isBot: true
    });
  });
```

- [ ] **Step 2: Run orchestrator test and verify RED**

Run:

```bash
npm test -- tests/chat-orchestrator.test.ts
```

Expected: FAIL because the orchestrator dispatches the raw LLM text with `- пункт` and unsupported `<script>` tags.

- [ ] **Step 3: Apply formatter in the reply job**

Modify `src/app/chat-orchestrator.ts`.

Add the import:

```ts
import { formatTelegramHtmlReply } from "./telegram-html.js";
```

In `runReplyJob()`, replace the send/save text usage after `const result = await this.executeReplyGeneration(request, logger);` with a formatted reply variable:

```ts
      const replyText = formatTelegramHtmlReply(result.text);

      const sent = await this.deps.replyDispatcher({
        chatId: request.chatId,
        replyToMessageId: request.triggerMessageId,
        text: replyText
      });

      this.deps.db.saveBotMessage({
        chatId: request.chatId,
        chatType: request.chatType,
        chatTitle: request.chatTitle,
        messageId: sent.messageId,
        text: replyText,
        createdAt: sent.createdAt,
        userId: this.deps.bot.userId,
        username: this.deps.bot.username,
        displayName: this.deps.bot.displayName,
        replyToMessageId: request.triggerMessageId
      });
```

- [ ] **Step 4: Run orchestrator tests and verify GREEN**

Run:

```bash
npm test -- tests/chat-orchestrator.test.ts
```

Expected: PASS.

---

### Task 3: Send Telegram Replies With HTML Parse Mode

**Files:**
- Modify: `src/app.ts`
- Modify: `tests/app.test.ts`

- [ ] **Step 1: Write failing Telegram transport test**

Add this test in `tests/app.test.ts` inside `describe("createApplication", () => { ... })`:

```ts
  test("sends bot replies with Telegram HTML parse mode", async () => {
    const { createApplication } = await import("../src/app.js");
    await createApplication(createEnv());

    botSendMessage.mockResolvedValue({
      message_id: 44,
      date: 1_744_000_000
    });

    const orchestratorDeps = chatOrchestratorConstructor.mock.calls[0]?.[0] as
      | {
          replyDispatcher?: (input: {
            chatId: number;
            replyToMessageId: number;
            text: string;
          }) => Promise<{ messageId: number; createdAt: string }>;
        }
      | undefined;

    const sent = await orchestratorDeps?.replyDispatcher?.({
      chatId: -1001,
      replyToMessageId: 11,
      text: "<b>Коротко</b>"
    });

    expect(botSendMessage).toHaveBeenCalledWith(-1001, "<b>Коротко</b>", {
      parse_mode: "HTML",
      reply_parameters: {
        message_id: 11
      }
    });
    expect(sent).toEqual({
      messageId: 44,
      createdAt: "2025-04-07T04:26:40.000Z"
    });
  });
```

- [ ] **Step 2: Run app test and verify RED**

Run:

```bash
npm test -- tests/app.test.ts
```

Expected: FAIL because `bot.api.sendMessage()` does not include `parse_mode: "HTML"`.

- [ ] **Step 3: Add HTML parse mode**

Modify `src/app.ts` in the `replyDispatcher` implementation:

```ts
      const sent = await bot.api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_parameters: {
          message_id: replyToMessageId
        }
      });
```

- [ ] **Step 4: Run app test and verify GREEN**

Run:

```bash
npm test -- tests/app.test.ts
```

Expected: PASS.

---

### Task 4: Add Telegram HTML Prompt Contract

**Files:**
- Modify: `src/llm/prompts.ts`
- Modify: `tests/llm-prompts.test.ts`

- [ ] **Step 1: Update prompt tests first**

In `tests/llm-prompts.test.ts`, update or add assertions so the prompt contract checks for Telegram HTML rules.

In the explain prompt test, add:

```ts
    expect(prompt).toContain("Use Telegram HTML-compatible structure.");
    expect(prompt).toContain("Use only this formatting subset: <b>, <i>, <code>, bullet points with •, and empty lines between sections.");
    expect(prompt).toContain("Use <b> for section headers.");
    expect(prompt).toContain("Do not wrap every word in formatting.");
    expect(prompt).toContain("<b>Смысл</b>");
    expect(prompt).toContain("<b>По сути</b>");
```

In the summarize prompt test, replace the old same-heading assertion:

```ts
    expect(prompt).toContain("do not start every answer with the same heading");
```

with:

```ts
    expect(prompt).toContain("<b>Коротко</b>");
    expect(prompt).toContain("<b>Итог</b>");
    expect(prompt).toContain("3 to 5 short bullet points using •");
```

In the decide prompt test, replace plain heading assertions:

```ts
    expect(prompt).toContain("Позиции:");
    expect(prompt).toContain("Что реально видно из переписки:");
    expect(prompt).toContain("Вердикт:");
```

with:

```ts
    expect(prompt).toContain("<b>Позиции</b>");
    expect(prompt).toContain("<b>Что видно</b>");
    expect(prompt).toContain("<b>Вердикт</b>");
    expect(prompt).toContain("Always use these 3 sections.");
```

- [ ] **Step 2: Run prompt tests and verify RED**

Run:

```bash
npm test -- tests/llm-prompts.test.ts
```

Expected: FAIL because `src/llm/prompts.ts` does not yet contain the HTML-only prompt contract.

- [ ] **Step 3: Replace global formatting rules**

In `src/llm/prompts.ts`, replace the current visual formatting rules in the `"Global rules:"` block:

```ts
    "- Use short visual paragraphs.",
    "- Separate sections with an empty line.",
    "- Prefer 2-4 bullets instead of one dense paragraph when listing points.",
    "- Avoid walls of text.",
    "- Do not start every answer with the same heading.",
    "- Make the response look good in Telegram plain text or Telegram HTML formatting.",
```

with:

```ts
    "- Use Telegram HTML-compatible structure.",
    "- Use only this formatting subset: <b>, <i>, <code>, bullet points with •, and empty lines between sections.",
    "- Use <b> for section headers.",
    "- Use <i> only for rare subtle emphasis.",
    "- Use <code> only for short inline technical terms or commands.",
    "- Use bullet points (•) for lists.",
    "- Separate sections with an empty line.",
    "- Keep responses visually clean and not dense.",
    "- Avoid large blocks of text.",
    "- Do not overuse formatting.",
    "- Do not create too many sections.",
    "- Do not exceed about 5 bullets in one section.",
    "- Do not wrap every word in formatting.",
    "- Prefer simplicity over decoration.",
    "- Do not use <a> links unless truly necessary.",
    "- Do not use large code blocks.",
    "- Do not use emojis as structural elements.",
```

- [ ] **Step 4: Update EXPLAIN response shape**

In `src/llm/prompts.ts`, replace the `EXPLAIN_PROMPT` `"Preferred response style:"` block with:

```ts
  "Preferred response shape:",
  "",
  "<b>Смысл</b>",
  "",
  "<short explanation in 1-2 lines>",
  "",
  "<b>По сути</b>",
  "",
  "• <point>",
  "• <point>",
  "• <optional point>",
  "",
  "Response shape rules:",
  "- First block is the plain explanation.",
  "- Add the second block only if it is useful.",
  "- Use no more than 3 bullets.",
  "- No meta commentary like 'this message is addressed to me'.",
  "- No generic instruction-only replies unless absolutely necessary.",
```

- [ ] **Step 5: Update SUMMARIZE response shape**

In `src/llm/prompts.ts`, replace the `SUMMARIZE_PROMPT` `"Preferred response shape:"` block with:

```ts
  "Preferred response shape:",
  "",
  "<b>Коротко</b>",
  "",
  "• <main point>",
  "• <main point>",
  "• <main point>",
  "• <optional final point>",
  "",
  "<b>Итог</b>",
  "<one short line if there is a real outcome>",
  "",
  "Response shape rules:",
  "- Use 3 to 5 short bullet points using •.",
  "- Do not force an outcome when there is no real outcome.",
  "- Include <b>Итог</b> only if it is meaningful.",
  "- Do not use the word 'Summary:' as a heading.",
  "- Use short visual paragraphs, not dense blocks.",
```

- [ ] **Step 6: Update DECIDE response shape**

In `src/llm/prompts.ts`, replace the current `DECIDE_PROMPT` `"Preferred response shape:"` block with:

```ts
  "Preferred response shape:",
  "",
  "<b>Позиции</b>",
  "",
  "• <b><participant or side>:</b> <their core claim>",
  "• <b><participant or side>:</b> <their core claim>",
  "• <optional more participants>",
  "",
  "<b>Что видно</b>",
  "",
  "• <observation>",
  "• <observation>",
  "",
  "<b>Вердикт</b>",
  "<short decision>",
  "",
  "Response shape rules:",
  "- Always use these 3 sections.",
  "- Keep each section short.",
  "- Keep the verdict to 1-2 lines maximum.",
  "- Do not repeat the same point in multiple sections.",
```

- [ ] **Step 7: Run prompt tests and verify GREEN**

Run:

```bash
npm test -- tests/llm-prompts.test.ts
```

Expected: PASS.

---

### Task 5: Verification, Eval Review, And Documentation Review

**Files:**
- Review: `scripts/intent-eval-fixtures.ts`
- Review: `README.md`
- Review: `docs/architecture.md`
- Review: `docs/development.md`

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npm test -- tests/telegram-html.test.ts tests/chat-orchestrator.test.ts tests/app.test.ts tests/llm-prompts.test.ts
```

Expected: PASS for all focused formatting, orchestrator, transport, and prompt tests.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Review intent eval fixtures**

Open `scripts/intent-eval-fixtures.ts` and verify these facts:

```ts
// Expected after this feature:
// - Existing fixtures still check semantic behavior, not exact formatting.
// - The prompt change does not require changing mustIncludeAny terms.
// - The prompt change does not require changing mustNotIncludeAny terms.
// - No fixture expects "Summary:".
```

If those facts hold, leave `scripts/intent-eval-fixtures.ts` unchanged and mention in the final response that eval fixtures were reviewed and deliberately left unchanged.

- [ ] **Step 5: Optionally run live intent evals when LLM env is available**

Run only if the environment has valid `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_REPLY_MODEL` values:

```bash
npm run eval:intents
```

Expected: the command saves a new `.eval-runs/<timestamp>/assistant-intents.json` and `.eval-runs/<timestamp>/assistant-intents.md` directory. Review the generated responses for broken HTML, unsupported tags, giant paragraphs, and `"Summary:"` spam.

If live eval env is unavailable, do not edit eval output files and mention in the final response that live evals were not run because the environment was not configured.

- [ ] **Step 6: Review durable docs**

Review these files:

```bash
sed -n '1,220p' README.md
sed -n '1,220p' docs/architecture.md
sed -n '1,220p' docs/development.md
```

Expected doc decision:

```md
- Update docs only if they currently describe reply formatting or Telegram send options in a way that becomes false.
- If they do not describe formatting details, leave them unchanged and mention that they were reviewed.
```

- [ ] **Step 7: Final local diff review**

Run:

```bash
git diff -- src/app/telegram-html.ts tests/telegram-html.test.ts src/app/chat-orchestrator.ts tests/chat-orchestrator.test.ts src/app.ts tests/app.test.ts src/llm/prompts.ts tests/llm-prompts.test.ts
```

Expected: diff is limited to the formatter, reply pipeline formatting, Telegram HTML parse mode, prompt contract, and tests.

---

## Acceptance Criteria

- Telegram replies are sent with `parse_mode: "HTML"`.
- Generated and local replies are sanitized before dispatch and before database save.
- Only `<b>`, `<i>`, and `<code>` tags survive sanitizer output.
- Unsupported tags do not reach Telegram.
- Raw `<`, `>`, and `&` text is escaped.
- Simple markdown-like bullet lines become `•` bullets.
- Excessive blank lines are trimmed.
- Unclosed allowed tags are closed deterministically.
- Prompts ask for Telegram HTML-compatible structure with section headers, bullets, spacing, and anti-formatting-spam constraints.
- EXPLAIN, SUMMARIZE, and DECIDE prompts contain their intended visual response shapes.
- Focused tests, typecheck, and full tests pass.
- Intent eval fixtures are reviewed and updated only if semantic expectations become incompatible.
