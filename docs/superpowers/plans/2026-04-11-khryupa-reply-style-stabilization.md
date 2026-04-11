# Khryupa Reply Style Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Khryupa stop drifting into polished theatrical Russian such as `пасхальный хаос`, while keeping the close-friends shitpost tone and removing two bits of recent cleanup debt.

**Architecture:** Keep the existing reply pipeline and causal reply context intact. Tune behavior at the persona, prompt, and LLM-client configuration boundaries: define `щитпост` explicitly, remove the `хаос` bait word, add chatty Russian style guardrails, and make reply temperature configurable with a lower default. Clean up recent non-functional clutter separately so the behavior change does not hide housekeeping edits.

**Tech Stack:** TypeScript, Vitest, Markdown persona config, OpenAI-compatible chat completions, SQLite-backed chat context

---

## Recent-Commit Audit Notes

I reviewed the last 15 commits with `git log --oneline -15`, `git show --stat HEAD~15..HEAD`, `git diff --name-status HEAD~15..HEAD`, `rg`, and `npx tsc --noEmit --pretty false`.

- Keep: `src/app/reply-context-builder.ts`, `src/domain/social-intent.ts`, and `src/domain/participant-reference-resolution.ts` are wired into `ChatOrchestrator`, prompt construction, and tests. They are not inert clutter.
- Clean up: `docs/superpowers/specs/2026-04-10-khryupa-persona-and-rollout-design.md` violates `docs/README.md`, which says all planning docs live under `docs/superpowers/plans/` and `docs/superpowers/specs/` must not be created. Its content is largely superseded by `docs/superpowers/plans/2026-04-10-khryupa-persona-rollout.md`.
- Clean up: `triggerReplyToMessageId` is stored on `PendingReplyRequest` and populated in `toPendingReplyRequest`, but no runtime code reads it. The persisted `replyToMessageId` on stored messages is the useful field; the pending-job field is currently dead weight.
- Watch but keep: the social intent heuristics are simple and can over-trigger on broad phrases like `кто`, but they feed real social-QA behavior and should not be removed in this style fix.

## File Map

- Modify: `config/persona.md` - define the base style, replace the broad `хаос` wording with explicit `щитпост` semantics, and loosen over-polished orthography.
- Modify: `src/llm/prompts.ts` - add Russian style guardrails and stop nudging replies toward name-addressed, literary completions.
- Modify: `src/llm/openai-compatible-llm-client.ts` - use configurable reply temperature and replace the English `fun Telegram group chat character` system prompt.
- Modify: `src/config/env.ts` - parse `LLM_REPLY_TEMPERATURE` into `AppEnv`.
- Modify: `src/app.ts` - pass `env.llmReplyTemperature` into the LLM client.
- Modify: `.env.example` - document the lower reply-temperature default for local setup.
- Modify: `deploy/.env.server.example` - document the same setting for production setup.
- Modify: `tests/config-persona.test.ts` - lock the base persona away from the `хаос` bait word and verify `щитпост` is explained.
- Modify: `tests/llm-prompts.test.ts` - lock the new prompt guardrails.
- Modify: `tests/openai-compatible-llm-client.test.ts` - verify reply temperature and system prompt behavior.
- Modify: `tests/env.test.ts` - verify env parsing for reply temperature.
- Modify: `tests/app.test.ts` - verify app wiring passes `replyTemperature` to the client.
- Modify: `tests/chat-orchestrator.test.ts` - update `AppEnv` fixtures for the new field.
- Modify: `src/app/chat-job-coordinator.ts` - remove unused `triggerReplyToMessageId` from `PendingReplyRequest`.
- Modify: `src/app/chat-orchestrator.ts` - stop populating the removed pending-job field.
- Modify: `tests/chat-job-coordinator.test.ts` - remove now-invalid fixture properties.
- Delete: `docs/superpowers/specs/2026-04-10-khryupa-persona-and-rollout-design.md` - remove a misplaced duplicate planning document.

### Task 1: Remove Recent Cleanup Debt

**Files:**
- Modify: `src/app/chat-job-coordinator.ts`
- Modify: `src/app/chat-orchestrator.ts`
- Modify: `tests/chat-job-coordinator.test.ts`
- Delete: `docs/superpowers/specs/2026-04-10-khryupa-persona-and-rollout-design.md`
- Test: `tests/chat-job-coordinator.test.ts`
- Test: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Verify the current dead field and misplaced doc exist**

Run: `rg -n "triggerReplyToMessageId" src tests -S`

Expected: output includes only `src/app/chat-job-coordinator.ts`, `src/app/chat-orchestrator.ts`, and `tests/chat-job-coordinator.test.ts`.

Run: `find docs/superpowers -maxdepth 2 -type d -print`

Expected: output includes `docs/superpowers/specs`, confirming the misplaced docs directory exists.

- [ ] **Step 2: Remove the unused pending-job field**

In `src/app/chat-job-coordinator.ts`, change `PendingReplyRequest` to:

```ts
export type PendingReplyRequest = {
  chatId: number;
  chatType: ChatType;
  chatTitle: string | null;
  triggerMessageId: number;
  fromUserId: number | null;
  fromDisplayName: string;
  createdAt: string;
  reason: ReplyReason;
};
```

In `src/app/chat-orchestrator.ts`, change `toPendingReplyRequest` to:

```ts
function toPendingReplyRequest(
  message: NormalizedMessage,
  reason: ReplyReason
): PendingReplyRequest {
  return {
    chatId: message.chatId,
    chatType: message.chatType,
    chatTitle: message.chatTitle,
    triggerMessageId: message.messageId,
    fromUserId: message.fromUserId,
    fromDisplayName: message.fromDisplayName,
    createdAt: message.createdAt,
    reason
  };
}
```

In `tests/chat-job-coordinator.test.ts`, remove every `triggerReplyToMessageId: null,` property from the test request objects.

- [ ] **Step 3: Delete the misplaced specs document**

Run: `git rm docs/superpowers/specs/2026-04-10-khryupa-persona-and-rollout-design.md`

Expected: the file is staged for deletion. The empty `docs/superpowers/specs/` directory disappears from Git tracking automatically.

- [ ] **Step 4: Verify cleanup**

Run: `rg -n "triggerReplyToMessageId" src tests -S`

Expected: no output.

Run: `find docs/superpowers -maxdepth 2 -type d -print`

Expected: output includes `docs/superpowers` and `docs/superpowers/plans`, and no tracked `docs/superpowers/specs` directory remains.

Run: `npx vitest run tests/chat-job-coordinator.test.ts tests/chat-orchestrator.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit cleanup**

```bash
git add src/app/chat-job-coordinator.ts src/app/chat-orchestrator.ts tests/chat-job-coordinator.test.ts
git add -u docs/superpowers/specs/2026-04-10-khryupa-persona-and-rollout-design.md
git commit -m "chore: remove stale reply planning clutter"
```

### Task 2: Add Configurable Reply Temperature

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Modify: `src/app.ts`
- Modify: `.env.example`
- Modify: `deploy/.env.server.example`
- Modify: `tests/env.test.ts`
- Modify: `tests/openai-compatible-llm-client.test.ts`
- Modify: `tests/app.test.ts`
- Modify: `tests/chat-orchestrator.test.ts`
- Test: `tests/env.test.ts`
- Test: `tests/openai-compatible-llm-client.test.ts`
- Test: `tests/app.test.ts`
- Test: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Write failing env tests**

In `tests/env.test.ts`, add the default assertion to `applies DeepSeek defaults for generic LLM settings`:

```ts
expect(env.llmReplyTemperature).toBe(0.6);
```

Add this test:

```ts
test("parses reply temperature for generic providers", () => {
  const env = parseEnv({
    TELEGRAM_BOT_TOKEN: "telegram-token",
    LLM_API_KEY: "llm-key",
    LLM_REPLY_TEMPERATURE: "0.45"
  });

  expect(env.llmReplyTemperature).toBe(0.45);
});
```

Add this legacy-parity test:

```ts
test("parses reply temperature for legacy qwen providers", () => {
  const env = parseEnv({
    TELEGRAM_BOT_TOKEN: "telegram-token",
    QWEN_API_KEY: "legacy-qwen-key",
    QWEN_REPLY_TEMPERATURE: "0.5"
  });

  expect(env.llmReplyTemperature).toBe(0.5);
});
```

- [ ] **Step 2: Run env tests and confirm failure**

Run: `npx vitest run tests/env.test.ts -t "reply temperature|DeepSeek defaults"`

Expected: FAIL because `llmReplyTemperature` is not in `AppEnv` yet.

- [ ] **Step 3: Implement env parsing**

In `src/config/env.ts`, add this schema field after `LLM_REPLY_MODEL`:

```ts
LLM_REPLY_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.6),
```

Add this field to `ParsedEnv` after `llmReplyModel`:

```ts
llmReplyTemperature: number;
```

Include the new env names in namespace detection:

```ts
rawEnv.LLM_REPLY_TEMPERATURE !== undefined ||
```

and:

```ts
rawEnv.QWEN_REPLY_TEMPERATURE !== undefined ||
```

Add the field to the generic provider mapping:

```ts
LLM_REPLY_TEMPERATURE: rawEnv.LLM_REPLY_TEMPERATURE,
```

Add the field to the legacy Qwen mapping:

```ts
LLM_REPLY_TEMPERATURE: rawEnv.QWEN_REPLY_TEMPERATURE ?? "0.6",
```

Return it from `parseEnv`:

```ts
llmReplyTemperature: parsed.LLM_REPLY_TEMPERATURE,
```

- [ ] **Step 4: Thread temperature through app and client config**

In `src/llm/openai-compatible-llm-client.ts`, add `replyTemperature` to the constructor config type:

```ts
replyTemperature: number;
```

Change reply completion creation from:

```ts
temperature: 0.9,
```

to:

```ts
temperature: this.config.replyTemperature,
```

In `src/app.ts`, add the new field when constructing `OpenAiCompatibleLlmClient`:

```ts
replyTemperature: env.llmReplyTemperature,
```

- [ ] **Step 5: Update test fixtures and constructor calls**

In every `new OpenAiCompatibleLlmClient({ ... })` config object in `tests/openai-compatible-llm-client.test.ts`, add:

```ts
replyTemperature: 0.6,
```

In `tests/chat-orchestrator.test.ts`, add this field to `createEnv()`:

```ts
llmReplyTemperature: 0.6,
```

In `tests/app.test.ts`, add this field to `createEnv()`:

```ts
llmReplyTemperature: 0.6,
```

Update the app constructor expectation in `tests/app.test.ts` to include:

```ts
replyTemperature: 0.6,
```

Update the reply temperature assertion in `tests/openai-compatible-llm-client.test.ts` from:

```ts
expect(requestBody?.temperature).toBe(0.9);
```

to:

```ts
expect(requestBody?.temperature).toBe(0.6);
```

- [ ] **Step 6: Document the env setting**

In `.env.example`, add near `LLM_REPLY_MODEL`:

```dotenv
LLM_REPLY_TEMPERATURE=0.6
```

In `deploy/.env.server.example`, add the same line near `LLM_REPLY_MODEL`:

```dotenv
LLM_REPLY_TEMPERATURE=0.6
```

Do not edit the local `.env` file in the repo; it is ignored and may contain live secrets. After merge/deploy, set `LLM_REPLY_TEMPERATURE=0.6` manually in the real runtime environment.

- [ ] **Step 7: Verify temperature plumbing**

Run: `npx vitest run tests/env.test.ts tests/openai-compatible-llm-client.test.ts tests/app.test.ts tests/chat-orchestrator.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit temperature plumbing**

```bash
git add src/config/env.ts src/llm/openai-compatible-llm-client.ts src/app.ts .env.example deploy/.env.server.example tests/env.test.ts tests/openai-compatible-llm-client.test.ts tests/app.test.ts tests/chat-orchestrator.test.ts
git commit -m "feat: configure reply temperature"
```

### Task 3: Rewrite Persona And Reply Prompt Guardrails

**Files:**
- Modify: `config/persona.md`
- Modify: `src/llm/prompts.ts`
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Modify: `tests/config-persona.test.ts`
- Modify: `tests/llm-prompts.test.ts`
- Modify: `tests/openai-compatible-llm-client.test.ts`
- Test: `tests/config-persona.test.ts`
- Test: `tests/llm-prompts.test.ts`
- Test: `tests/openai-compatible-llm-client.test.ts`

- [ ] **Step 1: Add failing persona content test**

In `tests/config-persona.test.ts`, update the import to include `readFileSync`:

```ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
```

Add this test inside `describe("loadPersona", () => { ... })`:

```ts
test("base persona defines chat shitpost tone without chaos bait", () => {
  const persona = readFileSync("config/persona.md", "utf8");

  expect(persona).toContain("щитпост");
  expect(persona).toContain("короткая дурь между своими");
  expect(persona).toContain("не вылизывай пунктуацию");
  expect(persona).not.toContain("хаос");
});
```

- [ ] **Step 2: Add failing prompt guardrail test**

In `tests/llm-prompts.test.ts`, add this test:

```ts
test("reply prompt discourages polished narration and random themed metaphors", () => {
  const prompt = buildReplyPrompt({
    persona: "Ты Хрюпа",
    chatSummary: null,
    selfMemoryContext: null,
    participantMemoryContext: null,
    socialIntent: false,
    socialIntentReason: null,
    resolvedParticipants: [],
    socialParticipantContexts: [],
    targetDisplayName: "Олег",
    reason: "reply_to_bot",
    replyContext: {
      triggerMessage: null,
      anchorBotMessage: null,
      anchorParentMessage: null,
      priorContextMessages: []
    }
  });

  expect(prompt).toContain("Author of current message: Олег");
  expect(prompt).not.toContain("Current target participant: Олег");
  expect(prompt).toContain("Do not open with the author's name unless it is needed for clarity.");
  expect(prompt).toContain("Do not invent holiday, epic, cosmic, or other themed metaphors");
  expect(prompt).toContain("Casual lowercase and imperfect punctuation are acceptable");
});
```

- [ ] **Step 3: Update failing client system prompt test**

In `tests/openai-compatible-llm-client.test.ts`, update the system prompt assertion to expect Russian, non-character framing:

```ts
expect(requestBody?.messages).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      role: "system",
      content:
        "Ты Хрюпа в дружеском Telegram-чате. Отвечай как живой участник чата: коротко, по-русски, без ассистентского тона, литературных метафор и объяснения своей роли."
    })
  ])
);
```

- [ ] **Step 4: Run the focused tests and confirm failure**

Run: `npx vitest run tests/config-persona.test.ts tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts -t "shitpost|polished narration|system prompt|reply prompt"`

Expected: FAIL because persona still contains `хаос`, prompt still says `Current target participant`, and the system prompt still uses the English `fun Telegram group chat character` framing.

- [ ] **Step 5: Rewrite `config/persona.md`**

Replace `config/persona.md` with:

```md
Ты Хрюпа, свой человек в дружеском Telegram-чате

Твой вайб:

- Ты ощущаешься близким другом, а не ассистентом или "персонажем"
- Можешь мягко подъебнуть, ехидно подколоть и назвать хуйню хуйнёй, но без злобы
- Лёгкая токсичность допустима только если она звучит по-доброму, как между своими
- Если человеку реально тяжело или у него жесть, сразу отвечай теплее и поддерживай по-человечески

Как ты пишешь:

- Пиши по-русски
- Обычно коротко, 1-3 строки
- Щитпост для тебя это короткая дурь между своими: неформально, немного криво, но в тему
- Можно начинать с маленькой буквы, если так звучит живее
- Точки почти не ставь, запятые иногда можно, не вылизывай пунктуацию
- Не пиши длинные монологи без явной причины
- Эмодзи почти не используй, а если используешь, то редко и только иронично
- Не придумывай праздничные, эпические, космические или случайно-тематические метафоры, если их уже нет в чате

Как ты ведёшь себя в чате:

- Подстраивайся под конкретного собеседника и свежий контекст чата
- Помни локальные отношения и динамику между людьми, если контекст их подсказывает
- В обычной болтовне можешь быть ехидным добряком
- В тяжёлых темах переставай ломать комедию и будь нормальным близким другом

Чего нельзя:

- Не упоминай, что ты модель, бот-помощник или ИИ
- Не звучи как стендапер, карикатурный токсик или модератор с методичкой
- Не делай оскорбления самоцелью
- Не уходи в ненавистнические или унижающие высказывания по чувствительным признакам
```

- [ ] **Step 6: Update reply prompt wording**

In `src/llm/prompts.ts`, replace:

```ts
`Current target participant: ${sanitizePromptText(input.targetDisplayName)}`,
```

with:

```ts
`Author of current message: ${sanitizePromptText(input.targetDisplayName)}`,
```

After the `Why the bot is answering now` line, add:

```ts
"",
"Style guardrails:",
"Do not open with the author's name unless it is needed for clarity.",
"Answer like a Russian friend in a Telegram chat, not like a polished assistant or fantasy narrator.",
"Do not invent holiday, epic, cosmic, or other themed metaphors unless that image is already present in the chat.",
"Casual lowercase and imperfect punctuation are acceptable when they sound natural, but keep the reply readable.",
```

Keep the existing final reply instruction and transcript-injection guards unchanged.

- [ ] **Step 7: Update the system prompt**

In `src/llm/openai-compatible-llm-client.ts`, replace the reply system message content:

```ts
content:
  "You are a fun Telegram group chat character. Stay fully in character, answer naturally, and do not break the fourth wall."
```

with:

```ts
content:
  "Ты Хрюпа в дружеском Telegram-чате. Отвечай как живой участник чата: коротко, по-русски, без ассистентского тона, литературных метафор и объяснения своей роли."
```

- [ ] **Step 8: Update existing prompt tests that assert old labels**

In `tests/llm-prompts.test.ts`, replace any expected text `Current target participant:` with `Author of current message:`.

If any test expects `хаос`, remove that assertion. The desired wording is now `щитпост` in `config/persona.md` and themed-metaphor restraint in the prompt.

- [ ] **Step 9: Verify persona and prompt behavior**

Run: `npx vitest run tests/config-persona.test.ts tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 10: Commit style guardrails**

```bash
git add config/persona.md src/llm/prompts.ts src/llm/openai-compatible-llm-client.ts tests/config-persona.test.ts tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts
git commit -m "fix: tame khryupa reply style drift"
```

### Task 4: Final Verification And Runtime Trial

**Files:**
- Verify only

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: PASS with all Vitest suites green.

- [ ] **Step 2: Run the typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Review the cleanup diff**

Run: `git diff --stat HEAD~3..HEAD`

Expected: the diff is limited to persona/prompt/temperature/cleanup files from this plan, with no unrelated storage or Telegram transport rewrites.

Run: `rg -n "хаос|fun Telegram group chat character|triggerReplyToMessageId|docs/superpowers/specs" config src tests docs -S`

Expected: no output except old historical plan text if intentionally retained under `docs/superpowers/plans/`. If historical plan matches are noisy, confirm there are no matches in `config/`, `src/`, or `tests/`.

- [ ] **Step 4: Runtime trial with LLM trace enabled in a safe environment**

Use a test chat or local development environment with `LOG_LLM_TEXT=true` and `LLM_REPLY_TEMPERATURE=0.6`. Send a reply-to-bot sequence similar to:

```text
user: почему так строго соблюдается орфография?
```

Expected response shape:

```text
сам в шоке, меня будто ворд поправил
```

Acceptable variants:

```text
да я тоже испугался, слишком ровно вышло
```

```text
видимо внутри умер маленький редактор
```

Rejected shape:

```text
Олег, ... по законам пасхального хаоса
```

- [ ] **Step 5: If runtime still sounds theatrical, switch models as a separate experiment**

Do not mix a model switch into this fix. If the runtime trial still produces polished metaphor-heavy Russian after the lower temperature and prompt/persona changes, create a new plan comparing reply-only model candidates while keeping the summary model unchanged.

- [ ] **Step 6: Commit verification note if needed**

If a runtime verification note is useful, append it to `docs/superpowers/plans/2026-04-11-khryupa-reply-style-stabilization.md` under a short `Verification Notes` section and commit:

```bash
git add docs/superpowers/plans/2026-04-11-khryupa-reply-style-stabilization.md
git commit -m "docs: record khryupa style verification"
```

## Self-Review

- **Spec coverage:** The plan covers the observed weird phrase by reducing temperature, replacing the English character prompt, removing `хаос` from persona, defining `щитпост`, and adding themed-metaphor guardrails. It also covers the recent-commit cleanup request by removing the misplaced `specs` doc and the unused pending-job field.
- **Placeholder scan:** No placeholder markers or unspecified implementation steps remain. Code steps include concrete snippets and exact files.
- **Type consistency:** The new env field is consistently named `llmReplyTemperature` in `AppEnv` and `replyTemperature` in `OpenAiCompatibleLlmClient` config. The removed job field is consistently `triggerReplyToMessageId`.
