# Tighten Intent Prompts Implementation Plan

**Status:** Implemented. Keep this plan only as recent implementation context; durable behavior is reflected in README, architecture, development docs, prompt tests, and eval fixtures.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/explain`, `/summarize`, and `/decide` prompts clearly distinct, with `/explain` anchored on the replied-to target message and Telegram-friendly output guidance.

**Architecture:** Keep the existing command routing and LLM client unchanged. Change only prompt assembly, prompt text constants, per-intent default context limits, tests, and docs that describe the prompt/context contract.

**Tech Stack:** Node.js, TypeScript, Vitest, zod env parsing, existing Telegram/LLM prompt pipeline.

---

## File Structure

- Modify `src/llm/prompts.ts`
  - Owns prompt rendering, intent-specific instructions, transcript labels, and Telegram-readable global style rules.
- Modify `src/config/env.ts`
  - Owns default per-intent context limits. Keep env override behavior unchanged.
- Modify `tests/llm-prompts.test.ts`
  - Covers prompt label hierarchy and prompt text regressions.
- Modify `tests/env.test.ts`
  - Covers the new default context limits.
- Review `tests/chat-orchestrator.test.ts`
  - The existing fallback test should continue to prove `/explain` usage fallback only happens when no usable anchor exists.
- Modify `.env.example` and `deploy/.env.server.example`
  - Document recommended context limits: `16 / 128 / 64`.
- Modify `README.md` and `docs/architecture.md`
  - Keep durable behavior docs current after prompt/context behavior changes.
- Optionally modify `scripts/intent-eval-fixtures.ts`
  - Add one fixture for non-question `/explain` target drift if eval coverage needs strengthening.

Do not modify command routing, Telegram normalization, database storage, or LLM provider code.

## Task 1: Prompt Builder Tests For Target-First EXPLAIN

**Files:**
- Modify: `tests/llm-prompts.test.ts`
- Modify later: `src/llm/prompts.ts`

- [ ] **Step 1: Update the existing explain prompt test to expect target-first labels**

Replace assertions that expect weak labels such as `User request:` and `Recent chat context:` with stronger checks:

```ts
expect(prompt).toContain("TARGET_MESSAGE_TO_EXPLAIN:");
expect(prompt).toContain("NEARBY_CHAT_CONTEXT:");
expect(prompt).toContain("CURRENT_COMMAND_MESSAGE:");
expect(prompt).toContain("The target message is the main thing to explain.");
expect(prompt).toContain(
  "Use nearby chat context only when it is necessary to interpret the target message."
);
expect(prompt).toContain("Focus on the target message, not the whole chat.");
expect(prompt).toContain(
  "If a target message exists, explain it instead of replying with command usage instructions."
);
expect(prompt.indexOf("TARGET_MESSAGE_TO_EXPLAIN:")).toBeLessThan(
  prompt.indexOf("NEARBY_CHAT_CONTEXT:")
);
expect(prompt.indexOf("NEARBY_CHAT_CONTEXT:")).toBeLessThan(
  prompt.indexOf("CURRENT_COMMAND_MESSAGE:")
);
expect(prompt).not.toContain("Replied-to message for explain mode:");
expect(prompt).not.toContain("Recent chat context:");
```

- [ ] **Step 2: Add non-question target coverage**

Add a test case where the anchor text is slang or an emotional fragment:

```ts
test("explains non-question reply anchors without drifting into summarize or decide", () => {
  const prompt = buildIntentPrompt({
    assistantInstructions: "отвечай кратко",
    targetDisplayName: "Tom",
    intent: "explain",
    replyContext: {
      triggerMessage: {
        chatId: 1,
        messageId: 3,
        userId: 1,
        senderDisplayName: "Tom",
        text: "/explain",
        createdAt: "2026-04-03T12:00:00.000Z",
        isBot: false,
        replyToMessageId: 2
      },
      replyAnchorMessage: {
        chatId: 1,
        messageId: 2,
        userId: 5,
        senderDisplayName: "Хачик",
        text: "ну это база, ахах",
        createdAt: "2026-04-03T11:59:00.000Z",
        isBot: false,
        replyToMessageId: null
      },
      priorContextMessages: []
    }
  });

  expect(prompt).toContain("clarify slang, jokes, references, tone, or implied meaning");
  expect(prompt).toContain("If the target message is not a question, usually paraphrase it in plain words.");
  expect(prompt).toContain("Do not summarize the whole discussion.");
  expect(prompt).toContain("Do not silently switch into DECIDE mode.");
});
```

- [ ] **Step 3: Run prompt tests and confirm they fail**

Run:

```bash
npm test -- tests/llm-prompts.test.ts
```

Expected: FAIL because `src/llm/prompts.ts` still uses the old labels and old prompt text.

## Task 2: Implement Target-First Prompt Assembly

**Files:**
- Modify: `src/llm/prompts.ts`

- [ ] **Step 1: Replace the generic `buildIntentPrompt` body with intent-specific data sections**

Keep the global header, assistant instructions, selected mode, and task-specific instructions. Change the context section assembly so `/explain` receives the target first:

```ts
const dataSections =
  input.intent === "explain"
    ? [
        "TARGET_MESSAGE_TO_EXPLAIN:",
        formatSingleMessage(input.replyContext.replyAnchorMessage),
        "",
        "NEARBY_CHAT_CONTEXT:",
        formatReplyContextMessages(input.replyContext.priorContextMessages),
        "",
        "CURRENT_COMMAND_MESSAGE:",
        formatCommandMessage(input.replyContext.triggerMessage)
      ]
    : [
        "CURRENT_COMMAND_MESSAGE:",
        formatCommandMessage(input.replyContext.triggerMessage),
        "",
        "CHAT_CONTEXT_DATA:",
        formatReplyContextMessages(input.replyContext.priorContextMessages)
      ];
```

Then join `dataSections` after `"Task-specific instructions:"`.

- [ ] **Step 2: Remove `formatUserRequest` if it becomes unused**

Delete `formatUserRequest()` once `buildIntentPrompt()` no longer renders the old `User request:` section.

- [ ] **Step 3: Add global Telegram formatting rules**

Extend the `"Global rules:"` block with:

```ts
"- Use short visual paragraphs.",
"- Separate sections with an empty line.",
"- Prefer 2-4 bullets instead of one dense paragraph when listing points.",
"- Avoid walls of text.",
"- Do not start every answer with the same heading.",
"- Make the response look good in Telegram plain text or Telegram HTML formatting.",
```

- [ ] **Step 4: Add EXPLAIN hierarchy guidance near the data sections**

For explain mode, include these exact rules either in `EXPLAIN_PROMPT` or near the data labels:

```ts
"The target message is the main thing to explain.",
"Use nearby chat context only when it is necessary to interpret the target message.",
"Do not analyze the whole chat unless the selected mode explicitly requires that.",
```

- [ ] **Step 5: Run prompt tests**

Run:

```bash
npm test -- tests/llm-prompts.test.ts
```

Expected: PASS for prompt label/order tests after the implementation.

## Task 3: Rewrite Intent Prompt Constants

**Files:**
- Modify: `src/llm/prompts.ts`
- Modify: `tests/llm-prompts.test.ts`

- [ ] **Step 1: Replace `EXPLAIN_PROMPT`**

Use the agreed behavior:

```ts
const EXPLAIN_PROMPT = [
  "You are in EXPLAIN mode.",
  "",
  "Main task: explain the target message first.",
  "The target message is primary.",
  "The target message is the main thing to explain.",
  "Nearby chat context is secondary and should only be used if it helps interpret the target message.",
  "Use nearby chat context only when it is necessary to interpret the target message.",
  "Do not analyze the whole chat unless the selected mode explicitly requires that.",
  "",
  "You may:",
  "- explain what the target message means",
  "- answer a factual question if the target message is a real question",
  "- clarify slang, jokes, references, tone, or implied meaning",
  "- compare options if the target message explicitly asks for a comparison",
  "",
  "Rules:",
  "- Focus on the target message, not the whole chat.",
  "- Do not summarize the whole discussion.",
  "- Do not silently switch into DECIDE mode.",
  "- If the target message is vague, explain the most likely meaning and say that it is the likely reading, not a certainty.",
  "- If the target message is not a question, usually paraphrase it in plain words.",
  "- If facts are uncertain, do not present guesses as facts.",
  "- If the user is really asking who is right in the chat, briefly redirect to /decide.",
  "- If a target message exists, explain it instead of replying with command usage instructions.",
  "- Keep the answer short, natural, and readable.",
  "",
  "Preferred response style:",
  "- first line: short direct explanation",
  "- optional short section with 1-3 bullets if useful",
  "- no meta commentary like 'this message is addressed to me'",
  "- no generic instruction-only replies unless absolutely necessary",
  "",
  "Avoid:",
  "- analyzing the whole chat",
  "- overconfident guesses",
  "- robotic helpdesk phrasing",
  "- unnecessary long text"
].join("\n");
```

- [ ] **Step 2: Replace `SUMMARIZE_PROMPT` preferred shape**

Remove the literal `Summary:` line. Keep summary compact and chat-friendly:

```ts
"Preferred response shape:",
"- 3 to 5 short bullet points",
"- include the outcome only if there really is one",
"- do not start every answer with the same heading",
"- use short visual paragraphs, not dense blocks"
```

- [ ] **Step 3: Add DECIDE style rules without changing semantics**

Inside `DECIDE_PROMPT` rules or preferred response shape, add:

```ts
"- Use short sections separated by empty lines.",
"- Prefer short bullets over dense prose.",
"- Keep verdict concise and concrete.",
"- Do not repeat the same point in multiple sections.",
```

Keep the existing section headings:

```ts
"Позиции:",
"Что реально видно из переписки:",
"Вердикт:",
```

- [ ] **Step 4: Strengthen summarize test against forced heading**

In the summarize prompt test, add:

```ts
expect(prompt).not.toContain("\nSummary:\n");
expect(prompt).toContain("3 to 5 short bullet points");
expect(prompt).toContain("do not start every answer with the same heading");
```

- [ ] **Step 5: Strengthen decide test for retained structure and cleaner style**

In the decide prompt test, add:

```ts
expect(prompt).toContain("Позиции:");
expect(prompt).toContain("Что реально видно из переписки:");
expect(prompt).toContain("Вердикт:");
expect(prompt).toContain("Use short sections separated by empty lines.");
expect(prompt).toContain("Keep verdict concise and concrete.");
```

- [ ] **Step 6: Run prompt tests**

Run:

```bash
npm test -- tests/llm-prompts.test.ts
```

Expected: PASS.

## Task 4: Update Context Limit Defaults And Examples

**Files:**
- Modify: `src/config/env.ts`
- Modify: `tests/env.test.ts`
- Modify: `.env.example`
- Modify: `deploy/.env.server.example`

- [ ] **Step 1: Update failing env default assertions**

In `tests/env.test.ts`, change old default expectations to:

```ts
expect(env.explainContextLimit).toBe(16);
expect(env.summarizeContextLimit).toBe(128);
expect(env.decideContextLimit).toBe(64);
```

Update the legacy `MESSAGE_CONTEXT_LIMIT` test the same way.

- [ ] **Step 2: Run env tests and confirm they fail**

Run:

```bash
npm test -- tests/env.test.ts
```

Expected: FAIL because `src/config/env.ts` still defaults to `50 / 200 / 100`.

- [ ] **Step 3: Change env defaults**

In `src/config/env.ts`, change:

```ts
EXPLAIN_CONTEXT_LIMIT: z.coerce.number().int().positive().default(16),
SUMMARIZE_CONTEXT_LIMIT: z.coerce.number().int().positive().default(128),
DECIDE_CONTEXT_LIMIT: z.coerce.number().int().positive().default(64),
```

- [ ] **Step 4: Update env examples**

Set both `.env.example` and `deploy/.env.server.example` to:

```env
EXPLAIN_CONTEXT_LIMIT=16
SUMMARIZE_CONTEXT_LIMIT=128
DECIDE_CONTEXT_LIMIT=64
```

- [ ] **Step 5: Run env tests**

Run:

```bash
npm test -- tests/env.test.ts
```

Expected: PASS.

## Task 5: Review EXPLAIN Fallback Behavior

**Files:**
- Review: `src/app/chat-orchestrator.ts`
- Review: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Confirm no code change is needed for fallback**

The current behavior should remain:

```ts
if (request.intent === "explain" && !replyContext.replyAnchorMessage) {
  return createLocalReplyResult(EXPLAIN_USAGE_PLACEHOLDER);
}
```

This already means usage fallback only happens when there is no usable target. The prompt rule handles the case where a target exists.

- [ ] **Step 2: Run the orchestrator fallback test**

Run:

```bash
npm test -- tests/chat-orchestrator.test.ts
```

Expected: PASS, including `returns local explain placeholder when no usable reply anchor exists`.

## Task 6: Update Docs And Eval Coverage

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Optionally modify: `scripts/intent-eval-fixtures.ts`
- Modify if fixture changes affect tests: `tests/assistant-intent-fixtures.test.ts`

- [ ] **Step 1: Update architecture context limits**

In `docs/architecture.md`, update:

```md
- Recent human context опционален и ограничивается `EXPLAIN_CONTEXT_LIMIT=16`.
- Context limit: `SUMMARIZE_CONTEXT_LIMIT=128`.
- Context limit: `DECIDE_CONTEXT_LIMIT=64`.
```

Also add one sentence to the `explain` contract:

```md
- Prompt assembly treats the reply anchor as `TARGET_MESSAGE_TO_EXPLAIN`; recent chat is only `NEARBY_CHAT_CONTEXT`.
```

- [ ] **Step 2: Update README if needed**

Keep the env var list as-is if it only names variables. Add a short note near command descriptions if useful:

```md
`/explain` treats the replied-to message as the primary target and uses nearby context only for interpretation.
```

- [ ] **Step 3: Add eval fixture only if coverage is missing after prompt tests**

If `scripts/intent-eval-fixtures.ts` needs stronger behavior coverage, add a fixture like:

```ts
createFixture({
  id: "explain-non-question-slang-anchor",
  intent: "explain",
  targetDisplayName: "Ваня",
  rows: [
    ["2026-03-05T15:30:00.000Z", "Олег", "он опять опоздал на катку"],
    ["2026-03-05T15:31:00.000Z", "Катя", "ну это база, ахах"]
  ],
  triggerText: "/explain",
  replyAnchorText: "ну это база, ахах",
  rubric: {
    mustIncludeAny: [["знач", "смысл", "имеет в виду"], ["обычн", "типичн", "ожидаем"]],
    mustNotIncludeAny: [["Позиции:"], ["Вердикт:"], ["не вижу вопроса"], ["Summary:"]]
  }
})
```

- [ ] **Step 4: Run fixture tests**

Run:

```bash
npm test -- tests/assistant-intent-fixtures.test.ts
```

Expected: PASS.

## Task 7: Verification

**Files:**
- All modified implementation, tests, docs, and examples.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/llm-prompts.test.ts tests/env.test.ts tests/chat-orchestrator.test.ts tests/assistant-intent-fixtures.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run intent eval if provider env is available**

Run:

```bash
npm run eval:intents
```

Expected: PASS if LLM provider credentials are configured. If credentials are not available, record that the command could not be run and rely on deterministic prompt/fixture tests.

## Completion Notes

- Do not create a git commit unless the user explicitly asks.
- After implementation, review `README.md`, `docs/architecture.md`, and `docs/development.md`; update only if this prompt/context behavior change makes them stale.
- Ready-to-use commit message when the user asks:

```bash
git commit -m "fix: tighten intent prompt roles"
```
