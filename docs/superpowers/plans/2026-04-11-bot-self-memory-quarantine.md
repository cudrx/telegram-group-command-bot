# Bot Self-Memory Quarantine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Khryupa from self-priming on stored descriptions of its own broken repeated replies.

**Architecture:** Keep chat summary, participant memory, and causal reply context, but remove bot self-memory from the reply generation path entirely. Leave bot self-memory storage in place for now as diagnostic data, then run a targeted server data cleanup to reject the already-poisoned bot memories and clear the stale summary that copied exact repeated bot phrases.

**Tech Stack:** TypeScript, Vitest, SQLite via `better-sqlite3`, `sqlite3` CLI for one-off server data repair, grammY Telegram bot runtime

---

## Database Evidence

The server copy at `data/bot_copy.sqlite` shows this is not only a prompt wording problem.

Read-only evidence commands:

```bash
sqlite3 -readonly -header -column "file:data/bot_copy.sqlite?immutable=1" \
  "SELECT 'chats' AS table_name, COUNT(*) AS rows FROM chats
   UNION ALL SELECT 'participants', COUNT(*) FROM participants
   UNION ALL SELECT 'chat_participants', COUNT(*) FROM chat_participants
   UNION ALL SELECT 'participant_aliases', COUNT(*) FROM participant_aliases
   UNION ALL SELECT 'participant_memories', COUNT(*) FROM participant_memories
   UNION ALL SELECT 'messages', COUNT(*) FROM messages;"
```

Observed:

```text
chats: 3
participants: 7
chat_participants: 10
participant_aliases: 30
participant_memories: 8
messages: 182
```

Main chat evidence:

```bash
sqlite3 -readonly -header -column "file:data/bot_copy.sqlite?immutable=1" \
  "SELECT SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bot_messages,
          SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS human_messages,
          SUM(CASE WHEN is_bot = 1 AND text LIKE '%ведро%' THEN 1 ELSE 0 END) AS bot_vedro,
          SUM(CASE WHEN is_bot = 1 AND text LIKE '%кот%' THEN 1 ELSE 0 END) AS bot_cat,
          SUM(CASE WHEN is_bot = 1 AND text LIKE '%пасх%' THEN 1 ELSE 0 END) AS bot_easter
   FROM messages
   WHERE chat_id = -1002155313986;"
```

Observed:

```text
bot_messages: 62
human_messages: 113
bot_vedro: 8
bot_cat: 11
bot_easter: 5
```

The active bot self-memory rows are all diagnostics about broken behavior, not useful personality memory:

```text
user_id 7378889635 Хрюпа:
- [durable] recurring_joke_with_oleg: repeats the 'ведро с водой' line every time Oleg speaks, creating a looped joke
- [durable] response_loop: repeats identical or near-identical responses after being challenged, suggesting a behavioral loop
- [durable] cat_metaphor_pattern: uses cat-related analogies to respond to aggression
- [volatile] time_zone_confusion: consistently misidentifies local time
```

The chat summary also contains an exact repeated bot phrase and explicitly frames it as a running joke. That stale summary should be cleared on the server after deploying the code fix.

## File Map

- Modify: `src/app/chat-orchestrator.ts` - stop loading bot self-memory for reply generation and stop passing it to the LLM client.
- Modify: `src/llm/openai-compatible-llm-client.ts` - remove `selfMemoryContext` from reply input plumbing.
- Modify: `src/llm/prompts.ts` - remove the `Chat-local self memory` section from reply prompts; keep summary prompt support for `selfMemoryUpdates` unchanged for now.
- Modify: `src/app.ts` only if TypeScript wiring requires constructor type adjustments.
- Modify: `src/domain/models.ts` only if a shared reply input type still exposes bot self-memory.
- Modify: `tests/chat-orchestrator.test.ts` - replace the existing "passes self-memory of the bot into reply generation" expectation with a quarantine expectation.
- Modify: `tests/llm-prompts.test.ts` - assert reply prompts do not include a self-memory section.
- Modify: `tests/openai-compatible-llm-client.test.ts` - remove `selfMemoryContext` from reply fixtures and assert prompt generation still works.
- Modify: `docs/architecture.md` - record that bot self-memory is currently stored only for diagnostics and is not part of reply generation.
- One-off server operation: reject poisoned bot self-memory rows and clear the stale summary for chat `-1002155313986`.

### Task 1: Remove Bot Self-Memory From Reply Generation

**Files:**
- Modify: `tests/chat-orchestrator.test.ts`
- Modify: `src/app/chat-orchestrator.ts`
- Test: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Replace the existing self-memory passing test**

In `tests/chat-orchestrator.test.ts`, replace the test named `passes self-memory of the bot into reply generation` with this test:

```ts
  test("does not pass bot self-memory into reply generation", async () => {
    const db = new FakeDatabaseClient();

    db.saveIncomingMessage(
      createIncomingMessage({
        messageId: 1,
        text: "обычное сообщение"
      })
    );
    db.saveBotMessage({
      chatId: 1,
      chatType: "group",
      chatTitle: "Friends",
      messageId: 2,
      text: "я уже тут",
      createdAt: "2026-04-03T12:00:30.000Z",
      userId: 77,
      username: "fun_bot",
      displayName: "Fun Bot"
    });
    db.applySummary(
      1,
      {
        chatSummary: "summary",
        memoryUpdates: [],
        selfMemoryUpdates: [
          {
            category: "behavior",
            key: "response_loop",
            valueText: "repeats the same reply after being challenged",
            stability: "durable",
            sourceKind: "observed",
            confidence: 0.91,
            cardinality: "single"
          }
        ]
      },
      2,
      "2026-04-03T12:05:00.000Z",
      {
        userId: 77,
        username: "fun_bot",
        displayName: "Fun Bot"
      }
    );

    const generateReply = vi.fn().mockResolvedValue(createReplyResult("держи"));
    const orchestrator = createOrchestrator({
      db,
      qwen: {
        generateReply,
        summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
      },
      replyDispatcher: vi.fn().mockResolvedValue({
        messageId: 1002,
        createdAt: "2026-04-03T12:06:00.000Z"
      })
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 3,
        text: "@fun_bot давай",
        entities: [{ type: "mention", offset: 0, length: 8 }]
      })
    );

    expect(generateReply).toHaveBeenCalledWith(
      expect.not.objectContaining({
        selfMemoryContext: expect.anything()
      })
    );
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run tests/chat-orchestrator.test.ts -t "does not pass bot self-memory into reply generation"
```

Expected: FAIL because `executeReplyGeneration` currently calls `db.getParticipantMemoryContext(request.chatId, this.deps.bot.userId)` and passes `selfMemoryContext` into `generateReply`.

- [ ] **Step 3: Remove the bot self-memory lookup and reply input field**

In `src/app/chat-orchestrator.ts`, change this:

```ts
    const selfMemoryContext = this.deps.db.getParticipantMemoryContext(
      request.chatId,
      this.deps.bot.userId
    );
```

to no code at all.

In the `this.deps.qwen.generateReply({ ... })` call, remove:

```ts
      selfMemoryContext,
```

In the exported `LlmClient` type near the top of the file, remove:

```ts
    selfMemoryContext: string | null;
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npx vitest run tests/chat-orchestrator.test.ts -t "does not pass bot self-memory into reply generation"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/app/chat-orchestrator.ts tests/chat-orchestrator.test.ts
git commit -m "fix: quarantine bot self-memory from replies"
```

Expected: commit succeeds.

### Task 2: Remove Self-Memory From Reply Prompt Plumbing

**Files:**
- Modify: `src/llm/prompts.ts`
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Modify: `tests/llm-prompts.test.ts`
- Modify: `tests/openai-compatible-llm-client.test.ts`
- Test: `tests/llm-prompts.test.ts`
- Test: `tests/openai-compatible-llm-client.test.ts`

- [ ] **Step 1: Write the failing prompt test**

In `tests/llm-prompts.test.ts`, update the test named `wraps reply transcript in an explicit untrusted block and includes memory context`:

Change its name to:

```ts
  test("wraps reply transcript in an explicit untrusted block and includes participant memory context", () => {
```

Remove this input property from that test:

```ts
      selfMemoryContext: "[durable] running_joke_with_tom: шутит про дедлайны",
```

Remove this assertion:

```ts
    expect(prompt).toContain("Chat-local self memory:");
```

Add this assertion:

```ts
    expect(prompt).not.toContain("Chat-local self memory:");
```

For every other `buildReplyPrompt({ ... })` call in `tests/llm-prompts.test.ts`, remove:

```ts
      selfMemoryContext: null,
```

- [ ] **Step 2: Run the focused prompt tests and verify they fail**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts
```

Expected: FAIL because `buildReplyPrompt` still requires `selfMemoryContext` and still renders `Chat-local self memory:`.

- [ ] **Step 3: Remove self-memory from `buildReplyPrompt`**

In `src/llm/prompts.ts`, remove this input property:

```ts
  selfMemoryContext: string | null;
```

Remove this section from the reply prompt array:

```ts
    "Chat-local self memory:",
    input.selfMemoryContext ?? "No self memory yet.",
    "",
```

Keep the summary prompt `selfMemoryUpdates` schema and instructions unchanged in this task.

- [ ] **Step 4: Remove self-memory from OpenAI-compatible reply input**

In `src/llm/openai-compatible-llm-client.ts`, remove this property from the `generateReply` input type:

```ts
    selfMemoryContext: string | null;
```

Remove the same property from the `buildReplyPrompt({ ... })` call inside `generateReply`.

In `tests/openai-compatible-llm-client.test.ts`, remove every reply fixture field:

```ts
      selfMemoryContext: null,
```

- [ ] **Step 5: Run the focused LLM tests and verify they pass**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. If TypeScript reports another `selfMemoryContext` reply fixture, remove that field from the fixture instead of reintroducing reply self-memory.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/llm/prompts.ts src/llm/openai-compatible-llm-client.ts tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts
git commit -m "refactor: remove self-memory from reply prompts"
```

Expected: commit succeeds.

### Task 3: Document The Quarantine

**Files:**
- Modify: `docs/architecture.md`
- Test: documentation review via `rg`

- [ ] **Step 1: Update architecture wording**

In `docs/architecture.md`, replace the MVP bullet:

```md
- хранить chat-local self-memory самого бота поверх глобального persona-ядра;
```

with:

```md
- хранить chat-local self-memory самого бота только как диагностический слой, не подавая его напрямую в reply generation;
```

In `Main Flows` > `Incoming Message`, replace:

```md
   - подтягивается chat-local self-memory бота;
   - self-memory используется только как аналитический фон о локальной динамике чата, а не как источник готовых фраз для следующей реплики;
```

with:

```md
   - chat-local self-memory бота не подтягивается в reply generation; этот слой временно quarantined из-за production evidence самопрайминга;
```

In `Database Model` > `participant_memories`, replace:

```md
Тот же memory-layer используется и для chat-local self-memory бота, но summary не может писать туда `core`-факты или переписывать базовую persona-конфигурацию.
```

with:

```md
Тот же memory-layer используется и для chat-local self-memory бота, но этот слой сейчас не участвует в reply prompt. Summary не может писать туда `core`-факты или переписывать базовую persona-конфигурацию.
```

- [ ] **Step 2: Verify the documentation no longer claims self-memory is used in replies**

Run:

```bash
rg -n "self-memory.*reply|reply generation|chat-local self-memory" docs/architecture.md
```

Expected: output says bot self-memory is stored as diagnostic/quarantined and is not directly fed into reply generation.

- [ ] **Step 3: Commit Task 3**

Run:

```bash
git add docs/architecture.md
git commit -m "docs: document bot self-memory quarantine"
```

Expected: commit succeeds.

### Task 4: Add Server Data Repair Instructions

**Files:**
- Modify: `docs/development.md`
- Test: manual SQL dry-run against `data/bot_copy.sqlite`

- [ ] **Step 1: Add a production data repair section**

Append this section to `docs/development.md`:

````md
## Production SQLite Data Repair

Before running one-off SQL on the production SQLite database, create a consistent backup from the server deploy directory:

```bash
sqlite3 data/bot.sqlite ".backup 'data/bot-before-repair.sqlite'"
```

Use read-only dry-run queries before writing:

```bash
sqlite3 -readonly -header -column data/bot.sqlite \
  "SELECT memory_id, chat_id, user_id, memory_key, stability, status, value_text
   FROM participant_memories
   WHERE chat_id = -1002155313986
     AND user_id = 7378889635
   ORDER BY last_seen_at DESC;"
```

To quarantine the known poisoned Khryupa self-memory rows and clear the stale main-chat summary after deploying the code fix:

```bash
sqlite3 data/bot.sqlite <<'SQL'
BEGIN;

UPDATE participant_memories
SET status = 'rejected',
    last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE chat_id = -1002155313986
  AND user_id = 7378889635
  AND status = 'active'
  AND memory_key IN (
    'recurring_joke_with_oleg',
    'response_loop',
    'cat_metaphor_pattern',
    'time_zone_confusion'
  );

UPDATE chat_participants
SET profile_summary_text = NULL,
    profile_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE chat_id = -1002155313986
  AND user_id = 7378889635;

UPDATE chats
SET summary_text = NULL,
    summary_updated_at = NULL
WHERE chat_id = -1002155313986;

COMMIT;
SQL
```

Verify after repair:

```bash
sqlite3 -readonly -header -column data/bot.sqlite \
  "SELECT memory_id, memory_key, status, value_text
   FROM participant_memories
   WHERE chat_id = -1002155313986
     AND user_id = 7378889635
   ORDER BY memory_id;"

sqlite3 -readonly -header -column data/bot.sqlite \
  "SELECT chat_id, summary_text, summary_updated_at
   FROM chats
   WHERE chat_id = -1002155313986;"
```
````

- [ ] **Step 2: Dry-run the read-only verification against the copied database**

Run:

```bash
sqlite3 -readonly -header -column "file:data/bot_copy.sqlite?immutable=1" \
  "SELECT memory_id, chat_id, user_id, memory_key, stability, status, value_text
   FROM participant_memories
   WHERE chat_id = -1002155313986
     AND user_id = 7378889635
   ORDER BY last_seen_at DESC;"
```

Expected: output includes the four active bot rows `recurring_joke_with_oleg`, `response_loop`, `cat_metaphor_pattern`, and `time_zone_confusion`.

- [ ] **Step 3: Commit Task 4**

Run:

```bash
git add docs/development.md
git commit -m "docs: add production memory repair notes"
```

Expected: commit succeeds.

### Task 5: Final Verification And Deploy

**Files:**
- No source changes beyond Tasks 1-4.
- Runtime: server Docker Compose deployment.

- [ ] **Step 1: Run full local verification**

Run:

```bash
npm test
npm run build
```

Expected: both commands pass.

- [ ] **Step 2: Deploy the committed fix**

Use the repository's existing deployment path. If deploying the local compose setup, rebuild `dist` and recreate the bot container:

```bash
npm run build
docker compose --env-file .env -f compose.yml up -d --force-recreate bot
```

If deploying the server GHCR image, build/publish the image using the existing release process, then restart the server service from the server deploy directory:

```bash
docker compose --env-file .env -f compose.yml up -d --force-recreate bot
```

Expected: the bot process restarts on the new code.

- [ ] **Step 3: Run the production data repair after deploy**

From the server deploy directory, run the backup and SQL block documented in `docs/development.md`.

Expected: Khryupa's four poisoned self-memory rows are `rejected`, Khryupa's `chat_participants.profile_summary_text` is `NULL`, and the main chat `summary_text` is `NULL`.

- [ ] **Step 4: Manual Telegram probe**

In the main Telegram chat, send one direct mention and one reply-to-bot probe. Use neutral prompts that previously triggered loops:

```text
@hrupa_bot ну что скажешь?
```

Then reply to the bot's answer:

```text
что щас в чате происходит?
```

Expected: the bot does not reuse the distinctive `ведро`, `кот`, or `пасхальный хаос` wording from the poisoned history. If it still repeats a phrase, capture `docker compose --env-file .env -f compose.yml logs --tail=200 bot` and inspect the new `llm_reply_prompt` before making another fix.

- [ ] **Step 5: Commit any final documentation corrections**

If the manual probe reveals a documentation mismatch only, update the relevant docs and commit:

```bash
git add docs/architecture.md docs/development.md
git commit -m "docs: update reply loop verification notes"
```

Expected: no source changes are included in this final docs-only commit unless a new bug is discovered and separately planned.
