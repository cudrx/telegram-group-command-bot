# Reply Loop Guards And Typing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Khryupa from entering reply-to loops, reduce unnecessary paid LLM calls, and make replies feel more alive with Telegram typing indicators and a small bounded send delay.

**Architecture:** Add a deterministic reply safety layer before LLM generation, then keep a second deterministic output guard after generation so repeated model output cannot pollute the chat. Keep causal reply context, but sanitize risky anchor bot text before it reaches the prompt. Typing and delay live at the app/transport boundary and never call the LLM.

**Tech Stack:** TypeScript, Vitest, SQLite via `better-sqlite3`, grammY Telegram API, OpenAI-compatible chat completions

---

## Evidence From Production Copy

The analyzed copy at `data/bot-for-analysis.sqlite` showed:

```text
PRAGMA integrity_check = ok
participant_memories rows for user_id 7378889635 = 0
summary_cursor_message_id for -1002155313986 = 35262
unsummarized_message_count for -1002155313986 = 50
```

The fresh loop started after the summary cursor, so it was not caused by long-term bot self-memory. The repeated bot text appeared 18 times between `2026-04-13 12:00:00` and `2026-04-13 12:02:13` MSK:

```text
ну ты и говно, да
а я тут просто сижу, как винтик в дыре
```

The loop was a reply chain: the user repeatedly replied to the bot's previous message with nearly identical text, and the next prompt included that previous bot message as `Message of yours being replied to`.

## Design Decisions

- Put token-saving gates before persona loading and before `qwen.generateReply`.
- Do not ask the LLM whether a loop is happening. Loop detection must be deterministic and cheap.
- Keep `reply_to_bot` causal context for normal cases, but do not pass a risky repeated/toxic anchor bot message to the prompt verbatim.
- If the pre-LLM guard detects a repeated reply-chain loop, return either a one-time deterministic loop-breaker reply or skip. It must not call `generateReply`.
- If the model still returns a duplicate, replace it with a deterministic loop-breaker once or skip if a loop-breaker was already sent recently. Do not make a second LLM call.
- Add a short reply-to-bot cooldown in group chats. Explicit mentions remain allowed through the general policy, but still pass duplicate-output safety.
- Start Telegram `typing` before an allowed reply job enters LLM generation; refresh it while the job is running; enforce only a bounded minimum visible typing duration, so slow LLM responses do not wait extra.
- Keep all new settings configurable in `.env.example` and production docs. Defaults should be conservative because the project is running on a free LLM tier.
- Do not create commits unless the user explicitly asks. Use "suggested commit groupings" at the end of implementation instead.

## File Map

- Create: `src/domain/reply-text-similarity.ts` - normalize chat text and compare exact or near-duplicate short replies.
- Create: `src/domain/reply-loop-guard.ts` - decide whether a reply request should be allowed, skipped, deterministically answered, or prompt-sanitized before LLM.
- Create: `src/app/typing-indicator.ts` - app-level helper for Telegram typing refresh and bounded visible delay.
- Modify: `src/domain/models.ts` - move the shared `ReplyReason` type into the domain layer so domain guards do not import from `src/app`.
- Modify: `src/app/chat-job-coordinator.ts` - import the shared `ReplyReason` type from `src/domain/models.ts`.
- Modify: `src/app/chat-orchestrator.ts` - run pre-LLM guard, sanitize prompt context, run post-LLM output guard, and wrap reply jobs with typing/delay.
- Modify: `src/app.ts` - wire `sendChatAction`, delay, and typing config into `ChatOrchestrator`.
- Modify: `src/config/env.ts` - parse reply safety and typing env vars.
- Modify: `.env.example` - document new defaults.
- Modify: `deploy/.env.server.example` - document production defaults.
- Modify: `src/llm/prompts.ts` - make the anchor section explicitly treat omitted bot anchors as intentional safety redaction.
- Modify: `tests/reply-loop-guard.test.ts` - cover loop detection and duplicate output replacement.
- Modify: `tests/typing-indicator.test.ts` - cover typing refresh and bounded visible delay without real timers leaking.
- Modify: `tests/chat-orchestrator.test.ts` - prove guard skips LLM in observed loops, preserves normal replies, and sends deterministic loop-breaker at most once.
- Modify: `tests/app.test.ts` - prove Telegram `sendChatAction("typing")` is wired.
- Modify: `tests/env.test.ts` - prove env parsing and defaults.
- Modify: `tests/llm-prompts.test.ts` - prove sanitized anchors are represented as safety redaction, not copied text.
- Modify after implementation: `README.md`, `docs/architecture.md`, `docs/development.md`, `docs/backlog/ideas.md`, `docs/todo/`, and `docs/superpowers/plans/` if durable behavior or stale notes changed.

---

### Task 1: Add Reply Safety And Typing Configuration

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `deploy/.env.server.example`
- Modify: `tests/env.test.ts`

- [ ] **Step 1: Write env tests for the new defaults**

Add tests in `tests/env.test.ts` that call `parseEnv` with minimal valid provider values and assert:

```ts
expect(env.replyToBotLoopCooldownMs).toBe(15_000);
expect(env.replyToBotMinIntervalMs).toBe(2500);
expect(env.replyRecentBotMessagesForGuard).toBe(8);
expect(env.replyLoopBreakerText).toBe("я зациклился, приторможу");
expect(env.replyMinTypingMs).toBe(900);
expect(env.replyMaxTypingMs).toBe(2200);
expect(env.replyTypingRefreshMs).toBe(4000);
```

Add another test that passes string overrides:

```ts
REPLY_TO_BOT_LOOP_COOLDOWN_MS: "7000",
REPLY_TO_BOT_MIN_INTERVAL_MS: "1200",
REPLY_RECENT_BOT_MESSAGES_FOR_GUARD: "5",
REPLY_LOOP_BREAKER_TEXT: "стоп, я повторяюсь",
REPLY_MIN_TYPING_MS: "100",
REPLY_MAX_TYPING_MS: "200",
REPLY_TYPING_REFRESH_MS: "3000"
```

and asserts the parsed values exactly match those overrides.

- [ ] **Step 2: Run the env tests and verify they fail**

Run:

```bash
npx vitest run tests/env.test.ts
```

Expected: FAIL because the new `AppEnv` fields do not exist yet.

- [ ] **Step 3: Add config fields**

In `src/config/env.ts`, extend `envSchema`:

```ts
REPLY_TO_BOT_LOOP_COOLDOWN_MS: z.coerce.number().int().min(0).default(15_000),
REPLY_TO_BOT_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(2500),
REPLY_RECENT_BOT_MESSAGES_FOR_GUARD: z.coerce.number().int().min(3).max(30).default(8),
REPLY_LOOP_BREAKER_TEXT: z.string().min(1).default("я зациклился, приторможу"),
REPLY_MIN_TYPING_MS: z.coerce.number().int().min(0).default(900),
REPLY_MAX_TYPING_MS: z.coerce.number().int().min(0).default(2200),
REPLY_TYPING_REFRESH_MS: z.coerce.number().int().min(1000).default(4000)
```

Add these fields to `ParsedEnv`:

```ts
replyToBotLoopCooldownMs: number;
replyToBotMinIntervalMs: number;
replyRecentBotMessagesForGuard: number;
replyLoopBreakerText: string;
replyMinTypingMs: number;
replyMaxTypingMs: number;
replyTypingRefreshMs: number;
```

Return the parsed values from `parseEnv`. After parsing, validate:

```ts
if (parsed.REPLY_MIN_TYPING_MS > parsed.REPLY_MAX_TYPING_MS) {
  throw new Error("REPLY_MIN_TYPING_MS must be less than or equal to REPLY_MAX_TYPING_MS.");
}
```

- [ ] **Step 4: Document config**

Add to `.env.example` and `deploy/.env.server.example` under behavior settings:

```dotenv
REPLY_TO_BOT_LOOP_COOLDOWN_MS=15000
REPLY_TO_BOT_MIN_INTERVAL_MS=2500
REPLY_RECENT_BOT_MESSAGES_FOR_GUARD=8
REPLY_LOOP_BREAKER_TEXT=я зациклился, приторможу
REPLY_MIN_TYPING_MS=900
REPLY_MAX_TYPING_MS=2200
REPLY_TYPING_REFRESH_MS=4000
```

- [ ] **Step 5: Verify config**

Run:

```bash
npx vitest run tests/env.test.ts
```

Expected: PASS.

---

### Task 2: Add Pure Text Similarity Helpers

**Files:**
- Create: `src/domain/reply-text-similarity.ts`
- Create: `tests/reply-text-similarity.test.ts`

- [ ] **Step 1: Write similarity tests**

Create `tests/reply-text-similarity.test.ts` with these cases:

```ts
import { describe, expect, test } from "vitest";

import {
  isNearDuplicateReplyText,
  normalizeReplyText
} from "../src/domain/reply-text-similarity.js";

describe("reply text similarity", () => {
  test("normalizes case, punctuation, repeated spaces, and yo/e differences", () => {
    expect(normalizeReplyText("Ну ты и говно, да.\nА я тут просто сижу")).toBe(
      "ну ты и говно да а я тут просто сижу"
    );
    expect(normalizeReplyText("Ёбаный   тест")).toBe("ебаный тест");
  });

  test("detects exact normalized duplicates", () => {
    expect(isNearDuplicateReplyText("Ты анальная пробка?", "ты анальная пробка")).toBe(true);
  });

  test("detects near duplicates with tiny punctuation or one-word drift", () => {
    expect(
      isNearDuplicateReplyText(
        "ну ты и говно, да\nа я тут просто сижу, как винтик в дыре",
        "ну ты и говно да а я просто сижу как винтик в дыре"
      )
    ).toBe(true);
  });

  test("does not collapse unrelated short replies", () => {
    expect(isNearDuplicateReplyText("ты где", "я дома")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the similarity tests and verify they fail**

Run:

```bash
npx vitest run tests/reply-text-similarity.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `reply-text-similarity`**

Create `src/domain/reply-text-similarity.ts`:

```ts
export function normalizeReplyText(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isNearDuplicateReplyText(left: string, right: string): boolean {
  const normalizedLeft = normalizeReplyText(left);
  const normalizedRight = normalizeReplyText(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftWords = new Set(normalizedLeft.split(" "));
  const rightWords = new Set(normalizedRight.split(" "));
  const intersectionSize = Array.from(leftWords).filter((word) => rightWords.has(word)).length;
  const unionSize = new Set([...leftWords, ...rightWords]).size;

  if (unionSize === 0) {
    return false;
  }

  return intersectionSize / unionSize >= 0.86 && Math.min(leftWords.size, rightWords.size) >= 5;
}
```

- [ ] **Step 4: Verify similarity tests**

Run:

```bash
npx vitest run tests/reply-text-similarity.test.ts
```

Expected: PASS.

---

### Task 3: Add Pre-LLM And Post-LLM Reply Loop Guard

**Files:**
- Modify: `src/domain/models.ts`
- Modify: `src/app/chat-job-coordinator.ts`
- Create: `src/domain/reply-loop-guard.ts`
- Create: `tests/reply-loop-guard.test.ts`

- [ ] **Step 1: Move `ReplyReason` to the domain layer**

In `src/domain/models.ts`, add:

```ts
export type ReplyReason = "mention" | "reply_to_bot" | "direct_message" | "interjection";
```

In `src/app/chat-job-coordinator.ts`, remove the local `ReplyReason` export and import it:

```ts
import type { ChatType, ReplyReason } from "../domain/models.js";
```

This keeps `src/domain/reply-loop-guard.ts` independent from `src/app`.

- [ ] **Step 2: Write guard tests for the production loop**

Create `tests/reply-loop-guard.test.ts` with tests for:

1. A `reply_to_bot` chain where the user repeats `Ты анальная пробка?` and the anchor bot message duplicates a recent bot message. Expected preflight decision:

```ts
{
  kind: "deterministic_reply",
  text: "я зациклился, приторможу",
  model: "deterministic-loop-guard",
  omitAnchorBotTextFromPrompt: true
}
```

2. The same chain when a recent bot message already equals `я зациклился, приторможу`. Expected:

```ts
{ kind: "skip", reason: "recent_loop_breaker_already_sent" }
```

3. A normal one-off `reply_to_bot` question. Expected:

```ts
{ kind: "allow", omitAnchorBotTextFromPrompt: false }
```

4. A non-looping `reply_to_bot` message inside `REPLY_TO_BOT_MIN_INTERVAL_MS` in a group chat. Expected:

```ts
{ kind: "skip", reason: "reply_to_bot_cooldown" }
```

5. The same message in a private chat with `enableReplyToBotCooldown: false`. Expected:

```ts
{ kind: "allow", omitAnchorBotTextFromPrompt: false }
```

6. A generated candidate reply that near-duplicates a recent bot reply. Expected postflight decision:

```ts
{
  kind: "replace",
  text: "я зациклился, приторможу",
  model: "deterministic-loop-guard"
}
```

7. A generated candidate reply that is distinct from recent bot replies. Expected:

```ts
{ kind: "allow" }
```

- [ ] **Step 3: Run guard tests and verify they fail**

Run:

```bash
npx vitest run tests/reply-loop-guard.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement guard decision types and preflight**

Create `src/domain/reply-loop-guard.ts` with exported types:

```ts
import type { ReplyContext, ReplyReason, StoredMessage } from "./models.js";
import { isNearDuplicateReplyText } from "./reply-text-similarity.js";

export type ReplyPreflightGuardDecision =
  | { kind: "allow"; omitAnchorBotTextFromPrompt: boolean }
  | {
      kind: "deterministic_reply";
      text: string;
      model: "deterministic-loop-guard";
      omitAnchorBotTextFromPrompt: boolean;
      reason: string;
    }
  | { kind: "skip"; reason: string };

export type ReplyPostflightGuardDecision =
  | { kind: "allow" }
  | { kind: "replace"; text: string; model: "deterministic-loop-guard"; reason: string }
  | { kind: "skip"; reason: string };
```

Implement:

```ts
export function decideReplyPreflightGuard(input: {
  reason: ReplyReason;
  replyContext: ReplyContext;
  recentMessages: StoredMessage[];
  now: string;
  replyToBotLoopCooldownMs: number;
  replyToBotMinIntervalMs: number;
  lastBotMessageAt: string | null;
  enableReplyToBotCooldown: boolean;
  loopBreakerText: string;
}): ReplyPreflightGuardDecision {
  if (input.reason !== "reply_to_bot") {
    return { kind: "allow", omitAnchorBotTextFromPrompt: false };
  }

  const trigger = input.replyContext.triggerMessage;
  const anchor = input.replyContext.anchorBotMessage;

  if (!trigger || !anchor) {
    return { kind: "allow", omitAnchorBotTextFromPrompt: false };
  }

  const recentBotMessages = input.recentMessages.filter((message) => message.isBot);
  const recentHumanTriggers = input.recentMessages.filter(
    (message) => !message.isBot && message.userId === trigger.userId
  );
  const hasRepeatedTrigger = recentHumanTriggers
    .filter((message) => message.messageId !== trigger.messageId)
    .some((message) => isNearDuplicateReplyText(message.text, trigger.text));
  const anchorRepeatsBotText = recentBotMessages
    .filter((message) => message.messageId !== anchor.messageId)
    .some((message) => isNearDuplicateReplyText(message.text, anchor.text));
  const loopBreakerAlreadySent = recentBotMessages.some((message) =>
    isNearDuplicateReplyText(message.text, input.loopBreakerText)
  );

  if (hasRepeatedTrigger && anchorRepeatsBotText) {
    if (loopBreakerAlreadySent) {
      return { kind: "skip", reason: "recent_loop_breaker_already_sent" };
    }

    return {
      kind: "deterministic_reply",
      text: input.loopBreakerText,
      model: "deterministic-loop-guard",
      omitAnchorBotTextFromPrompt: true,
      reason: "repeated_reply_to_bot_chain"
    };
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
```

Use `replyToBotLoopCooldownMs` to limit `recentMessages` by `createdAt` when it is greater than `0`. If parsing a timestamp fails, keep the message in the recent set so the guard remains conservative.

Add:

```ts
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
```

- [ ] **Step 5: Implement postflight guard**

In the same file, implement:

```ts
export function decideReplyPostflightGuard(input: {
  candidateText: string;
  recentMessages: StoredMessage[];
  loopBreakerText: string;
}): ReplyPostflightGuardDecision {
  const recentBotMessages = input.recentMessages.filter((message) => message.isBot);
  const duplicatesRecentBot = recentBotMessages.some((message) =>
    isNearDuplicateReplyText(message.text, input.candidateText)
  );

  if (!duplicatesRecentBot) {
    return { kind: "allow" };
  }

  const loopBreakerAlreadySent = recentBotMessages.some((message) =>
    isNearDuplicateReplyText(message.text, input.loopBreakerText)
  );

  if (loopBreakerAlreadySent) {
    return { kind: "skip", reason: "duplicate_candidate_after_loop_breaker" };
  }

  return {
    kind: "replace",
    text: input.loopBreakerText,
    model: "deterministic-loop-guard",
    reason: "duplicate_candidate_reply"
  };
}
```

- [ ] **Step 6: Verify guard tests**

Run:

```bash
npx vitest run tests/reply-loop-guard.test.ts tests/reply-text-similarity.test.ts
```

Expected: PASS.

---

### Task 4: Integrate The Guard Into Reply Generation Before LLM Calls

**Files:**
- Modify: `src/app/chat-orchestrator.ts`
- Modify: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Write orchestrator regression tests**

Add tests in `tests/chat-orchestrator.test.ts`:

1. `skips the llm and sends a deterministic loop breaker for repeated reply-to-bot chains`
   - Seed messages matching the production loop: bot message, user reply, duplicate bot reply, repeated user reply.
   - Call `handleIncomingMessage` with the latest user reply.
   - Assert `generateReply` was not called.
   - Assert `replyDispatcher` was called once with `text: "я зациклился, приторможу"`.

2. `skips repeated loop breaker replies without calling the llm`
   - Seed the same chain plus a recent bot loop-breaker message.
   - Assert `generateReply` was not called.
   - Assert `replyDispatcher` was not called.

3. `allows normal reply-to-bot messages through to the llm`
   - Seed a one-off bot reply and a human question with different text.
   - Assert `generateReply` was called once.
   - Assert `replyDispatcher` was called with the LLM result.

4. `skips non-looping reply-to-bot messages inside the short group cooldown`
   - Seed a recent bot reply.
   - Send a group `reply_to_bot` message within `REPLY_TO_BOT_MIN_INTERVAL_MS`.
   - Assert `generateReply` was not called.
   - Assert `replyDispatcher` was not called.

5. `does not apply the reply-to-bot cooldown to private chats`
   - Seed a recent bot reply in a private chat.
   - Send a private `reply_to_bot` message within `REPLY_TO_BOT_MIN_INTERVAL_MS`.
   - Assert `generateReply` was called once.

6. `replaces duplicate llm output with deterministic loop breaker`
   - Configure `generateReply` to return text equal to a recent bot message.
   - Assert `replyDispatcher` receives `я зациклился, приторможу`.

- [ ] **Step 2: Run focused orchestrator tests and verify they fail**

Run:

```bash
npx vitest run tests/chat-orchestrator.test.ts
```

Expected: FAIL because guard integration does not exist.

- [ ] **Step 3: Fetch recent messages once per reply job**

In `executeReplyGeneration`, after `buildReplyContext`, fetch recent messages:

```ts
const recentMessagesForGuard = this.deps.db.getMessagesBefore(
  request.chatId,
  request.triggerMessageId + 1,
  this.deps.env.replyRecentBotMessagesForGuard
);
```

This uses existing storage methods and avoids a schema change.

- [ ] **Step 4: Run preflight before persona loading and before LLM**

Move `loadPersona` below the preflight guard. Call:

```ts
const preflight = decideReplyPreflightGuard({
  reason: request.reason,
  replyContext,
  recentMessages: recentMessagesForGuard,
  now,
  replyToBotLoopCooldownMs: this.deps.env.replyToBotLoopCooldownMs,
  replyToBotMinIntervalMs: this.deps.env.replyToBotMinIntervalMs,
  lastBotMessageAt: chatState.lastBotMessageAt,
  enableReplyToBotCooldown: request.chatType !== "private",
  loopBreakerText: this.deps.env.replyLoopBreakerText
});
```

If `preflight.kind === "skip"`, log:

```ts
logger.info("reply_preflight_guard_skipped", {
  reason: preflight.reason,
  replyReason: request.reason,
  replyToMessageId: request.triggerMessageId
});
```

and return `null`.

If `preflight.kind === "deterministic_reply"`, return:

```ts
{
  text: preflight.text,
  model: preflight.model,
  latencyMs: 0,
  attemptCount: 0,
  promptTokensEstimate: 0
}
```

- [ ] **Step 5: Sanitize risky anchor text before prompt construction**

Add a local helper in `chat-orchestrator.ts`:

```ts
function sanitizeReplyContextForPrompt(
  replyContext: ReplyContext,
  options: { omitAnchorBotText: boolean }
): ReplyContext {
  if (!options.omitAnchorBotText || !replyContext.anchorBotMessage) {
    return replyContext;
  }

  return {
    ...replyContext,
    anchorBotMessage: {
      ...replyContext.anchorBotMessage,
      text: "[previous bot reply omitted because it appears repetitive or unsafe to copy]"
    }
  };
}
```

Pass the sanitized context into `generateReply`:

```ts
const promptReplyContext = sanitizeReplyContextForPrompt(replyContext, {
  omitAnchorBotText: preflight.omitAnchorBotTextFromPrompt
});
```

- [ ] **Step 6: Run postflight after LLM generation and before dispatch**

Store the LLM result in a variable, then call:

```ts
const postflight = decideReplyPostflightGuard({
  candidateText: generated.text,
  recentMessages: recentMessagesForGuard,
  loopBreakerText: this.deps.env.replyLoopBreakerText
});
```

If `postflight.kind === "replace"`, return a result with:

```ts
{
  text: postflight.text,
  model: postflight.model,
  latencyMs: generated.latencyMs,
  attemptCount: generated.attemptCount,
  promptTokensEstimate: generated.promptTokensEstimate
}
```

If `postflight.kind === "skip"`, log `reply_postflight_guard_skipped` and return `null`.

- [ ] **Step 7: Verify orchestrator guard behavior**

Run:

```bash
npx vitest run tests/chat-orchestrator.test.ts tests/reply-loop-guard.test.ts
```

Expected: PASS.

---

### Task 5: Add Telegram Typing Indicator And Bounded Reply Delay

**Files:**
- Create: `src/app/typing-indicator.ts`
- Create: `tests/typing-indicator.test.ts`
- Modify: `src/app/chat-orchestrator.ts`
- Modify: `src/app.ts`
- Modify: `tests/chat-orchestrator.test.ts`
- Modify: `tests/app.test.ts`

- [ ] **Step 1: Write typing helper tests**

Create `tests/typing-indicator.test.ts` using fake timers. Cover:

1. `withTypingIndicator` calls `sendTyping` immediately.
2. It refreshes typing every `refreshMs` while the wrapped job is still pending.
3. It waits only until the randomly chosen visible typing duration has elapsed.
4. It clears the interval when the wrapped job throws and rethrows the error.

- [ ] **Step 2: Run typing tests and verify they fail**

Run:

```bash
npx vitest run tests/typing-indicator.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the typing helper**

Create `src/app/typing-indicator.ts`:

```ts
export type TypingIndicatorOptions = {
  chatId: number;
  minTypingMs: number;
  maxTypingMs: number;
  refreshMs: number;
  random: () => number;
  delay: (ms: number) => Promise<void>;
  sendTyping: (chatId: number) => Promise<void>;
};

export async function withTypingIndicator<T>(
  options: TypingIndicatorOptions,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  const targetVisibleMs = pickDelayMs(options.minTypingMs, options.maxTypingMs, options.random);
  let interval: NodeJS.Timeout | null = null;

  await safeSendTyping(options.sendTyping, options.chatId);

  if (options.refreshMs > 0) {
    interval = setInterval(() => {
      void safeSendTyping(options.sendTyping, options.chatId);
    }, options.refreshMs);
    interval.unref?.();
  }

  try {
    const result = await operation();
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = Math.max(targetVisibleMs - elapsedMs, 0);

    if (remainingMs > 0) {
      await options.delay(remainingMs);
    }

    return result;
  } finally {
    if (interval) {
      clearInterval(interval);
    }
  }
}

function pickDelayMs(minMs: number, maxMs: number, random: () => number): number {
  if (maxMs <= minMs) {
    return minMs;
  }

  return Math.round(minMs + random() * (maxMs - minMs));
}

async function safeSendTyping(
  sendTyping: (chatId: number) => Promise<void>,
  chatId: number
): Promise<void> {
  try {
    await sendTyping(chatId);
  } catch {
    // Typing action is best-effort and must not block an actual reply.
  }
}
```

- [ ] **Step 4: Wire dependencies into `ChatOrchestrator`**

In `src/app/chat-orchestrator.ts`, add deps:

```ts
sendTyping: (chatId: number) => Promise<void>;
delay: (ms: number) => Promise<void>;
```

Wrap the body of `runReplyJob` after `reply_job_started`:

```ts
const result = await withTypingIndicator(
  {
    chatId: request.chatId,
    minTypingMs: this.deps.env.replyMinTypingMs,
    maxTypingMs: this.deps.env.replyMaxTypingMs,
    refreshMs: this.deps.env.replyTypingRefreshMs,
    random: this.deps.random,
    delay: this.deps.delay,
    sendTyping: this.deps.sendTyping
  },
  () => this.executeReplyGeneration(request, logger)
);
```

This covers LLM replies and deterministic guard replies with the same visible behavior.

- [ ] **Step 5: Wire Telegram `typing` in `app.ts`**

In `createApplication`, add:

```ts
sendTyping: async (chatId) => {
  await bot.api.sendChatAction(chatId, "typing");
},
delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
```

Update the grammY mock in `tests/app.test.ts` to include `sendChatAction`.

- [ ] **Step 6: Verify app and typing integration**

Run:

```bash
npx vitest run tests/typing-indicator.test.ts tests/app.test.ts tests/chat-orchestrator.test.ts
```

Expected: PASS.

---

### Task 6: Tighten Prompt Handling For Sanitized Anchors

**Files:**
- Modify: `src/llm/prompts.ts`
- Modify: `tests/llm-prompts.test.ts`

- [ ] **Step 1: Write prompt test for omitted anchor text**

Add a test in `tests/llm-prompts.test.ts` where `replyContext.anchorBotMessage.text` is:

```text
[previous bot reply omitted because it appears repetitive or unsafe to copy]
```

Assert the built prompt contains that text and also contains:

```text
If the bot message being replied to is omitted, answer only the current user message and earlier human context; do not reconstruct or imitate the omitted wording.
```

- [ ] **Step 2: Run prompt test and verify it fails**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts
```

Expected: FAIL because the new instruction is absent.

- [ ] **Step 3: Add prompt instruction**

In `src/llm/prompts.ts`, near the existing anti-copy guardrails, add:

```ts
"If the bot message being replied to is omitted, answer only the current user message and earlier human context; do not reconstruct or imitate the omitted wording.",
```

- [ ] **Step 4: Verify prompt tests**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts
```

Expected: PASS.

---

### Task 7: Add Production Data Repair For Stale Summary

**Files:**
- Modify: `docs/development.md`

- [ ] **Step 1: Add a no-LLM production repair section**

Add a section to `docs/development.md` after the existing SQLite repair notes. It must say this repair is only for the main production chat after deploying the loop guard code.

Use:

```bash
DB=/opt/test-chatbot/data/bot.sqlite
BACKUP=/opt/test-chatbot/data/bot-before-reply-loop-guard-2026-04-13.sqlite
sqlite3 "$DB" ".backup '$BACKUP'"
```

Then:

```bash
DB=/opt/test-chatbot/data/bot.sqlite
sqlite3 "$DB" <<'SQL'
UPDATE chats
SET summary_text = NULL,
    summary_updated_at = NULL
WHERE chat_id = -1002155313986;
SQL
```

Do not reset `summary_cursor_message_id`; re-summarizing the old full chat would spend extra LLM tokens and is not needed for this fix.

- [ ] **Step 2: Add verification SQL**

Add:

```bash
DB=/opt/test-chatbot/data/bot.sqlite
sqlite3 "$DB" -header -column <<'SQL'
SELECT chat_id, summary_text, summary_updated_at, summary_cursor_message_id
FROM chats
WHERE chat_id = -1002155313986;
SQL
```

Expected: `summary_text` and `summary_updated_at` are `NULL`, while `summary_cursor_message_id` stays unchanged.

---

### Task 8: Update Durable Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`
- Review: `docs/backlog/ideas.md`
- Review: `docs/todo/`
- Review: `docs/superpowers/plans/`

- [ ] **Step 1: Update README behavior overview**

Add a short bullet near the current MVP feature list:

```text
- deterministic reply loop guards and Telegram typing indicators for safer, less spammy replies
```

- [ ] **Step 2: Update architecture invariants**

In `docs/architecture.md`, add invariants:

```text
- reply safety guards run before paid reply LLM calls whenever enough local context exists to detect a repeated reply chain;
- deterministic loop-breaker replies and skip decisions must not call the LLM;
- post-LLM duplicate output guards may replace or skip a generated reply, but must not make a second LLM call;
- Telegram typing indicators and visible reply delays are transport/app behavior, not LLM behavior, and must never trigger extra model calls.
```

Update the incoming message flow to mention preflight guard, sanitized prompt context, postflight output guard, and typing/delay.

- [ ] **Step 3: Update development guide**

In `docs/development.md`, document the new env vars and add a warning:

```text
For free-tier LLM usage, keep deterministic guards before LLM calls. Do not move loop detection into prompt-only instructions or a separate LLM classifier.
```

- [ ] **Step 4: Review backlog and todo notes**

Run:

```bash
rg -n "loop|повтор|reply|typing|cooldown|кулдаун|Хрюпа" docs/backlog docs/todo docs/superpowers/plans -S
```

If a note is fully covered by this plan, update it to point to `docs/superpowers/plans/2026-04-13-reply-loop-guards-and-typing.md`. If it is not covered, leave it in place.

---

### Task 9: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/reply-text-similarity.test.ts tests/reply-loop-guard.test.ts tests/typing-indicator.test.ts tests/chat-orchestrator.test.ts tests/app.test.ts tests/env.test.ts tests/llm-prompts.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

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

- [ ] **Step 5: Inspect cost-sensitive behavior**

Run:

```bash
rg -n "generateReply|analyzeIntervention|summarizeConversation|decideReplyPreflightGuard|decideReplyPostflightGuard|withTypingIndicator" src/app src/domain src/llm -S
```

Verify by reading the output:

- preflight guard runs before `generateReply`;
- deterministic loop-breaker and skip paths do not call `generateReply`;
- postflight duplicate handling does not call `generateReply` a second time;
- typing indicator wraps reply work but does not call any LLM client;
- summary repair docs do not reset `summary_cursor_message_id`.

## Suggested Commit Groupings

Do not commit unless the user asks. If the user asks for commits later, use these groups:

1. `feat: add deterministic reply loop guards`
2. `feat: show typing while generating replies`
3. `docs: document reply loop guard rollout`
