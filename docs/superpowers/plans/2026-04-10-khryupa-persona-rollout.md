# Khryupa Persona Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update Khryupa's persona and prompt framing to sound like a close chat friend, then verify the branch is ready for a clean-db rollout and post-merge social-context testing.

**Architecture:** Keep the existing persona-loading path intact so the main behavior change lives in `config/persona.md`, then make one small prompt-level adjustment in the reply prompt to avoid contradicting that persona with generic "playful" assistant framing. Lock the intended tone with focused prompt tests, and document the exact operational reset/merge/test sequence in the plan outcome.

**Tech Stack:** TypeScript, Vitest, Markdown config persona, SQLite via `better-sqlite3`

---

### Task 1: Lock The New Persona Requirements In Tests

**Files:**
- Modify: `tests/llm-prompts.test.ts`
- Modify: `config/persona.md`
- Test: `tests/llm-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("reply prompt preserves khryupa's short close-friend tone", () => {
  const prompt = buildReplyPrompt({
    persona: [
      "Ты Хрюпа",
      "Пишешь как близкий друг из общего чата",
      "Эмодзи почти не используешь и только иронично",
      "Можешь мягко подъебнуть, но если человеку тяжело, поддерживаешь по-доброму"
    ].join("\n"),
    chatSummary: null,
    selfMemoryContext: null,
    participantMemoryContext: null,
    socialIntent: false,
    socialIntentReason: null,
    resolvedParticipants: [],
    socialParticipantContexts: [],
    targetDisplayName: "Артём",
    reason: "direct mention",
    recentMessages: []
  });

  expect(prompt).toContain("Эмодзи почти не используешь и только иронично");
  expect(prompt).toContain("если человеку тяжело, поддерживаешь по-доброму");
  expect(prompt).toContain("Reply in Russian. Keep it concise, natural, and in-character.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/llm-prompts.test.ts -t "reply prompt preserves khryupa's short close-friend tone"`
Expected: FAIL because the reply prompt still says "Keep it playful" instead of the tighter natural/concise framing.

- [ ] **Step 3: Write minimal implementation**

```ts
"Reply in Russian. Keep it concise, natural, and in-character. Match the chat's informal energy without overusing emojis. Avoid mentioning that you are an AI model."
```

Also rewrite `config/persona.md` so it explicitly says:

```md
Ты Хрюпа, свой человек в дружеском Telegram-чате

Твой вайб:

- Ты ощущаешься близким другом
- Можешь мягко подъебнуть и ехидно подколоть, но без злобы
- Если человеку реально тяжело, сразу отвечаешь теплее и поддерживаешь по-человечески

Как ты пишешь:

- Пиши по-русски
- Обычно коротко, 1-3 строки
- Обычно начинай с Большой буквы
- Точки почти не ставь, запятые иногда можно
- Эмодзи не спамь, если используешь, то редко и иронично
- Не пиши как ассистент, стендапер или карикатурный токсик
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/llm-prompts.test.ts -t "reply prompt preserves khryupa's short close-friend tone"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/llm-prompts.test.ts src/llm/prompts.ts config/persona.md
git commit -m "feat: refine khryupa persona voice"
```

### Task 2: Verify The Wider Prompt Suite Still Passes

**Files:**
- Modify: `tests/llm-prompts.test.ts`
- Test: `tests/llm-prompts.test.ts`

- [ ] **Step 1: Add one broader assertion for emoji restraint**

```ts
expect(prompt).toContain("without overusing emojis");
```

- [ ] **Step 2: Run prompt tests**

Run: `npx vitest run tests/llm-prompts.test.ts`
Expected: PASS

- [ ] **Step 3: Run the full automated suite**

Run: `npm test`
Expected: PASS with all Vitest suites green.

- [ ] **Step 4: Commit**

```bash
git add tests/llm-prompts.test.ts
git commit -m "test: cover khryupa prompt constraints"
```

### Task 3: Prepare The Clean-Database Rollout Procedure

**Files:**
- Modify: `docs/superpowers/plans/2026-04-10-khryupa-persona-rollout.md`
- Modify: `deploy/.env.server.example`
- Test: `main:.github/workflows/deploy.yml`

- [ ] **Step 1: Confirm the production SQLite path from deploy assets**

Run: `git show main:deploy/.env.server.example`
Expected: output contains `SQLITE_PATH=/app/data/bot.sqlite`

- [ ] **Step 2: Document the server reset command sequence**

Use this operational sequence in the plan notes:

```bash
docker compose down
rm -f /absolute/path/to/persistent/data/bot.sqlite
docker compose up -d
docker compose logs --tail=200
```

The absolute host path must be resolved on the server before deletion so we do not guess wrong about the mounted data directory.

- [ ] **Step 3: Record the post-merge validation checklist**

```md
- Open the chat and send a direct mention to trigger a reply
- Verify the first reply is short and does not include a random emoji
- Ask a social reference question such as "кто?" after a participant mention
- Ask a friendly distress-style message and confirm Khryupa switches from irony to support
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-04-10-khryupa-persona-rollout.md
git commit -m "docs: add khryupa rollout procedure"
```

### Task 4: Merge And Deploy

**Files:**
- Modify: `config/persona.md`
- Test: `main`

- [ ] **Step 1: Rebase or merge latest main into the working branch if needed**

Run: `git fetch origin`
Expected: local refs updated successfully

- [ ] **Step 2: Merge the feature branch into main**

Run: `git switch main && git merge --ff-only codex/social-context-mvp1`
Expected: branch fast-forwards cleanly to include social context and persona changes

- [ ] **Step 3: Push main to trigger deploy**

Run: `git push origin main`
Expected: GitHub Actions deploy workflow starts for the new commit

- [ ] **Step 4: Verify deployment health**

Run: `gh run watch --exit-status`
Expected: deploy workflow completes successfully

- [ ] **Step 5: Manual chat verification**

Run these chat probes after deploy:

```text
Артём: кто?
Артём: так вот кто титан
Артём: чет мне сегодня совсем хуево
```

Expected:
- social reference replies use participant context where available
- no emoji spam
- support tone appears in the heavy-message case

- [ ] **Step 6: Commit**

```bash
git add config/persona.md src/llm/prompts.ts tests/llm-prompts.test.ts
git commit -m "chore: finalize khryupa rollout"
```
