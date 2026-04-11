# Bot Self-Memory Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove bot self-memory from the MVP reply and summary architecture so Khryupa cannot self-prime on long-term descriptions of its own repeated behavior.

**Architecture:** Keep the stable core: persona, chat summary as analytical background, participant memory, and causal reply context. Remove bot self-memory from reply generation, stop generating/storing new `selfMemoryUpdates`, and repair already-poisoned production data. The only bot-authored text allowed into reply generation is the concrete bot message being replied to in causal context.

**Tech Stack:** TypeScript, Vitest, SQLite via `better-sqlite3`, `sqlite3` CLI for one-off production repair, grammY Telegram runtime

---

## Decision Summary

- Bot self-memory is not part of the product core for the MVP.
- `selfMemoryContext` must be removed from orchestrator, LLM client input, and reply prompt builder input.
- `Chat-local self memory` must not appear in reply prompts.
- Summary generation must stop requesting `selfMemoryUpdates`.
- Storage must stop applying bot self-memory updates.
- Existing poisoned bot self-memory rows and stale summary/profile text must be cleaned on production after deploy.
- Future diagnostics require a separate safe design, but must not reappear as identity, habits, or "I usually do X" memory that influences replies.

## Production Evidence

The server copy at `data/bot_copy.sqlite` shows the loop is data-backed, not just a prompt wording issue.

Read-only evidence command:

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

Main chat repetition counts:

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

The active bot self-memory rows are all diagnostic descriptions of broken behavior:

```text
user_id 7378889635 Хрюпа:
- [durable] recurring_joke_with_oleg: repeats the 'ведро с водой' line every time Oleg speaks, creating a looped joke
- [durable] response_loop: repeats identical or near-identical responses after being challenged, suggesting a behavioral loop
- [durable] cat_metaphor_pattern: uses cat-related analogies to respond to aggression
- [volatile] time_zone_confusion: consistently misidentifies local time
```

The chat summary also contains the exact repeated `ведро` phrase and frames it as a running joke. That stale summary can keep poisoning replies even after code changes, so production data repair is mandatory.

## File Map

- Modify: `src/app/chat-orchestrator.ts` - remove bot self-memory lookup and `selfMemoryContext` from `LlmClient.generateReply`.
- Modify: `src/llm/openai-compatible-llm-client.ts` - remove `selfMemoryContext` reply input and remove `selfMemoryUpdates` from summary schema expectations.
- Modify: `src/llm/prompts.ts` - remove `Chat-local self memory` from reply prompts and remove `selfMemoryUpdates` from summary prompt instructions.
- Modify: `src/domain/models.ts` - remove `BotSelfMemoryUpdate` and `SummaryResult.selfMemoryUpdates`.
- Modify: `src/storage/database.ts` - stop applying bot self-memory updates in `applySummary`.
- Modify: `tests/chat-orchestrator.test.ts` - assert bot self-memory is not passed to reply generation; update summary fixtures.
- Modify: `tests/llm-prompts.test.ts` - assert reply prompts contain no self-memory section and summary prompts no longer ask for `selfMemoryUpdates`.
- Modify: `tests/openai-compatible-llm-client.test.ts` - update reply and summary fixtures/schema expectations.
- Modify: `tests/storage-database.test.ts` - remove or replace bot self-memory storage tests.
- Modify: `docs/architecture.md` - document the new invariant: no long-term bot-derived memory in reply path.
- Modify: `docs/development.md` - add production SQLite repair steps.
- One-off server operation: reject existing poisoned bot self-memory rows and clear stale summary/profile text for chat `-1002155313986`.

## Acceptance Criteria

- `rg -n "selfMemoryContext|Chat-local self memory" src tests` returns no matches.
- `rg -n "selfMemoryUpdates|BotSelfMemoryUpdate" src tests` returns no matches.
- Reply prompts may include `Message of yours being replied to`, but must not include long-term descriptions of bot habits, identity, repeated jokes, loops, or time mistakes.
- Summary prompts still generate `chatSummary` and participant `memoryUpdates`, but no longer generate bot self-memory.
- `npm test`, `npm run typecheck`, and `npm run build` pass.
- Production repair marks Khryupa's poisoned self-memory rows as `rejected` and clears stale summary/profile text.

### Task 1: Remove Bot Self-Memory From Reply Generation

**Files:**
- Modify: `tests/chat-orchestrator.test.ts`
- Modify: `src/app/chat-orchestrator.ts`
- Test: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Replace the existing self-memory reply test**

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

Expected: FAIL because `executeReplyGeneration` still loads bot self-memory and passes `selfMemoryContext`.

- [ ] **Step 3: Remove reply self-memory from the orchestrator**

In `src/app/chat-orchestrator.ts`, remove this property from the `LlmClient.generateReply` input type:

```ts
    selfMemoryContext: string | null;
```

In `executeReplyGeneration`, remove the bot self-memory lookup:

```ts
    const selfMemoryContext = this.deps.db.getParticipantMemoryContext(
      request.chatId,
      this.deps.bot.userId
    );
```

In the `this.deps.qwen.generateReply({ ... })` call, remove:

```ts
      selfMemoryContext,
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
git commit -m "fix: remove bot self-memory from replies"
```

Expected: commit succeeds.

### Task 2: Remove Self-Memory From Reply Prompt Plumbing

**Files:**
- Modify: `tests/llm-prompts.test.ts`
- Modify: `tests/openai-compatible-llm-client.test.ts`
- Modify: `src/llm/prompts.ts`
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Test: `tests/llm-prompts.test.ts`
- Test: `tests/openai-compatible-llm-client.test.ts`

- [ ] **Step 1: Update prompt tests to reject the self-memory section**

In `tests/llm-prompts.test.ts`, rename:

```ts
  test("wraps reply transcript in an explicit untrusted block and includes memory context", () => {
```

to:

```ts
  test("wraps reply transcript in an explicit untrusted block and includes participant memory context", () => {
```

In that test, remove this input field:

```ts
      selfMemoryContext: "[durable] running_joke_with_tom: шутит про дедлайны",
```

Replace this assertion:

```ts
    expect(prompt).toContain("Chat-local self memory:");
```

with:

```ts
    expect(prompt).not.toContain("Chat-local self memory:");
```

In every other `buildReplyPrompt({ ... })` fixture in `tests/llm-prompts.test.ts`, remove:

```ts
      selfMemoryContext: null,
```

- [ ] **Step 2: Run prompt tests and verify they fail**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts
```

Expected: FAIL because `buildReplyPrompt` still requires and renders self-memory.

- [ ] **Step 3: Remove self-memory from `buildReplyPrompt`**

In `src/llm/prompts.ts`, remove this input field:

```ts
  selfMemoryContext: string | null;
```

Remove this prompt section:

```ts
    "Chat-local self memory:",
    input.selfMemoryContext ?? "No self memory yet.",
    "",
```

Keep the existing summary and participant memory sections in reply prompts.

- [ ] **Step 4: Remove self-memory from OpenAI-compatible reply input**

In `src/llm/openai-compatible-llm-client.ts`, remove this field from the `generateReply` input type:

```ts
    selfMemoryContext: string | null;
```

In `tests/openai-compatible-llm-client.test.ts`, remove every reply fixture field:

```ts
      selfMemoryContext: null,
```

- [ ] **Step 5: Run focused LLM tests and verify they pass**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/llm/prompts.ts src/llm/openai-compatible-llm-client.ts tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts
git commit -m "refactor: remove self-memory from reply prompts"
```

Expected: commit succeeds.

### Task 3: Stop Generating And Storing Bot Self-Memory

**Files:**
- Modify: `tests/llm-prompts.test.ts`
- Modify: `tests/openai-compatible-llm-client.test.ts`
- Modify: `tests/storage-database.test.ts`
- Modify: `tests/chat-orchestrator.test.ts`
- Modify: `src/llm/prompts.ts`
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Modify: `src/domain/models.ts`
- Modify: `src/storage/database.ts`
- Test: `tests/llm-prompts.test.ts`
- Test: `tests/openai-compatible-llm-client.test.ts`
- Test: `tests/storage-database.test.ts`

- [ ] **Step 1: Update the summary prompt test**

In `tests/llm-prompts.test.ts`, in the test named `summary prompt describes structured memory updates`, replace:

```ts
    expect(prompt).toContain("selfMemoryUpdates");
    expect(prompt).toContain('"key": "running_joke_with_tom"');
    expect(prompt).toContain("Never use selfMemoryUpdates to rewrite the bot's core persona");
    expect(prompt).toContain("describe it as behavior to avoid rather than a joke to continue");
    expect(prompt).toContain("Do not copy exact distinctive bot phrases into chatSummary or selfMemoryUpdates");
```

with:

```ts
    expect(prompt).not.toContain("selfMemoryUpdates");
    expect(prompt).not.toContain('"key": "running_joke_with_tom"');
    expect(prompt).not.toContain("Never use selfMemoryUpdates");
    expect(prompt).toContain("Do not copy exact distinctive bot phrases into chatSummary");
```

- [ ] **Step 2: Run the summary prompt test and verify it fails**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts -t "summary prompt describes structured memory updates"
```

Expected: FAIL because `buildSummaryPrompt` still includes `selfMemoryUpdates`.

- [ ] **Step 3: Remove `selfMemoryUpdates` from the summary prompt**

In `src/llm/prompts.ts`, remove this JSON shape block from `buildSummaryPrompt`:

```ts
      '  "selfMemoryUpdates": [',
      "    {",
      '      "category": "relationship",',
      '      "key": "running_joke_with_tom",',
      '      "valueText": "часто шутит про дедлайны с Томом",',
      '      "stability": "durable",',
      '      "sourceKind": "observed",',
      '      "confidence": 0.81,',
      '      "cardinality": "single"',
      "    }",
      "  ]",
```

Remove these summary instructions:

```ts
    "Use selfMemoryUpdates only for the bot's chat-local evolving memory: promises, recurring jokes, local relationships, or habits in this specific chat.",
    "If the bot repeated a phrase, got stuck in a loop, malfunctioned, or made a time mistake, describe it as behavior to avoid rather than a joke to continue.",
    "Do not copy exact distinctive bot phrases into chatSummary or selfMemoryUpdates unless the exact wording is necessary to understand the event.",
    "Never use selfMemoryUpdates to rewrite the bot's core persona, name, global role, or system rules.",
    "For selfMemoryUpdates, only use durable or volatile stability.",
```

Add this instruction near the existing `Only store facts that are useful beyond this chunk.` line:

```ts
    "Do not create long-term memory about the bot's own behavior, identity, habits, repeated phrases, loops, or time mistakes.",
    "If the bot repeated a phrase, got stuck in a loop, malfunctioned, or made a time mistake, describe that only in chatSummary as an anti-pattern to avoid.",
    "Do not copy exact distinctive bot phrases into chatSummary unless the exact wording is necessary to understand the event.",
```

- [ ] **Step 4: Remove `selfMemoryUpdates` from parsed summary results**

In `src/llm/openai-compatible-llm-client.ts`, remove the `selfMemoryUpdates` field from `summarySchema`:

```ts
  selfMemoryUpdates: z.array(
    z.object({
      category: z.string().min(1),
      key: z.string().min(1),
      valueText: z.string().min(1),
      stability: z.enum(["core", "durable", "volatile"]),
      sourceKind: z.enum(["explicit", "observed", "inferred"]),
      confidence: z.number().min(0).max(1),
      cardinality: z.enum(["single", "multi"])
    })
  ).default([])
```

In the summary system message, replace:

```ts
"You compress group chat conversations into a short chat summary, participant memory deltas, and chat-local self-memory deltas for the bot. Return only a valid JSON object."
```

with:

```ts
"You compress group chat conversations into a short chat summary and participant memory deltas. Return only a valid JSON object."
```

- [ ] **Step 5: Remove `BotSelfMemoryUpdate` from domain types**

In `src/domain/models.ts`, delete the `BotSelfMemoryUpdate` type:

```ts
export type BotSelfMemoryUpdate = {
  category: string;
  key: string;
  valueText: string;
  stability: ParticipantMemoryStability;
  sourceKind: ParticipantMemorySourceKind;
  confidence: number;
  cardinality: ParticipantMemoryCardinality;
};
```

In `SummaryResult`, replace:

```ts
  selfMemoryUpdates: BotSelfMemoryUpdate[];
```

with no field.

- [ ] **Step 6: Stop applying bot self-memory in storage**

In `src/storage/database.ts`, in `applySummary`, remove this whole block:

```ts
        if (
          currentBotIdentity &&
          summary.selfMemoryUpdates.length > 0
        ) {
          upsertChatParticipant(this.db, {
            chatId: targetChatId,
            userId: currentBotIdentity.userId,
            username: currentBotIdentity.username,
            displayName: currentBotIdentity.displayName,
            firstName: null,
            lastName: null,
            seenAt: timestamp
          });

          for (const update of summary.selfMemoryUpdates) {
            mergeParticipantMemory(
              this.db,
              targetChatId,
              {
                ...update,
                userId: currentBotIdentity.userId
              },
              timestamp,
              "bot_self"
            );
          }
        }
```

Then remove the now-unused `botIdentity` parameter from the public method signature. Change:

```ts
  applySummary(
    chatId: number,
    result: SummaryResult,
    appliedThroughMessageId: number,
    updatedAt: string,
    botIdentity?: {
      userId: number;
      username: string | null;
      displayName: string;
    }
  ): void {
```

to:

```ts
  applySummary(
    chatId: number,
    result: SummaryResult,
    appliedThroughMessageId: number,
    updatedAt: string
  ): void {
```

Inside the transaction callback, remove this argument:

```ts
        currentBotIdentity?: {
          userId: number;
          username: string | null;
          displayName: string;
        }
```

At the end of `applySummary`, change:

```ts
    transaction(chatId, result, appliedThroughMessageId, updatedAt, botIdentity);
```

to:

```ts
    transaction(chatId, result, appliedThroughMessageId, updatedAt);
```

In `src/app/chat-orchestrator.ts`, update the `this.deps.db.applySummary(...)` call in `runSummaryJob` by removing the final bot identity argument:

```ts
        {
          userId: this.deps.bot.userId,
          username: this.deps.bot.username,
          displayName: this.deps.bot.displayName
        }
```

- [ ] **Step 7: Update summary fixtures and storage tests**

In tests, remove `selfMemoryUpdates: []` from all `SummaryResult` fixtures and remove any non-empty `selfMemoryUpdates` fixture data. Remove the final bot identity argument from every `db.applySummary(...)` call.

In `tests/storage-database.test.ts`, delete the test named:

```ts
test("stores bot self-memory in the same chat-local memory layer without rewriting core persona", () => {
```

Replace it with:

```ts
  test("does not store bot self-memory from summaries", () => {
    const db = DatabaseClient.open(":memory:");

    db.saveIncomingMessage(
      createIncomingMessage({
        chatId: 1,
        messageId: 1,
        createdAt: "2026-04-03T12:00:00.000Z",
        text: "@bot погнали"
      })
    );

    db.applySummary(
      1,
      {
        chatSummary: "summary",
        memoryUpdates: []
      },
      1,
      "2026-04-03T12:05:00.000Z"
    );

    expect(db.getParticipantMemoryContext(1, 77)).toBeNull();

    db.close();
  });
```

- [ ] **Step 8: Run focused summary/storage tests**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts tests/storage-database.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run typecheck and remove remaining references**

Run:

```bash
npm run typecheck
rg -n "selfMemoryUpdates|BotSelfMemoryUpdate|selfMemoryContext|Chat-local self memory" src tests
```

Expected: `npm run typecheck` passes and `rg` prints no matches.

- [ ] **Step 10: Commit Task 3**

Run:

```bash
git add src/llm/prompts.ts src/llm/openai-compatible-llm-client.ts src/domain/models.ts src/storage/database.ts tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts tests/storage-database.test.ts tests/chat-orchestrator.test.ts
git commit -m "refactor: remove bot self-memory from summaries"
```

Expected: commit succeeds.

### Task 4: Update Architecture Documentation

**Files:**
- Modify: `docs/architecture.md`
- Test: `rg`

- [ ] **Step 1: Update MVP scope**

In `docs/architecture.md`, replace:

```md
- хранить chat-local self-memory самого бота поверх глобального persona-ядра;
```

with:

```md
- не хранить и не использовать долговременную самореферентную память бота в продуктовом reply path;
```

- [ ] **Step 2: Update product invariants**

Replace the current self-memory invariant:

```md
- если `chatSummary`, participant memory или chat-local self-memory описывают повтор фразы, зацикливание, malfunction или ошибку времени, reply prompt должен трактовать это как поведение, которого нужно избегать, а не как running joke или стиль для продолжения.
```

with:

```md
- бот не должен иметь долговременную самореферентную память, которая влияет на генерацию ответов.
- долговременные описания поведения бота, его привычек, repeated jokes, loops или time mistakes не должны попадать в reply prompt; исключение только одно: конкретное bot-сообщение в causal reply context, если пользователь отвечает именно на него.
- если `chatSummary` описывает повтор фразы, зацикливание, malfunction или ошибку времени, это должно быть сформулировано как anti-pattern, а не как running joke или стиль для продолжения.
```

- [ ] **Step 3: Update incoming message flow**

In `Main Flows` > `Incoming Message`, remove:

```md
   - подтягивается chat-local self-memory бота;
   - self-memory используется только как аналитический фон о локальной динамике чата, а не как источник готовых фраз для следующей реплики;
```

Add this bullet after persona override:

```md
   - chat-local self-memory бота не подтягивается и не участвует в reply generation;
```

- [ ] **Step 4: Update idle summary flow**

In `Main Flows` > `Idle Summary`, replace:

```md
   - массив `memoryUpdates`.
   - массив `selfMemoryUpdates` для локальной памяти персонажа.
```

with:

```md
   - массив `memoryUpdates` только для участников.
```

Replace:

```md
5. Summary prompt должен описывать повторяющиеся ошибки, loops и time mistakes как поведение, которого нужно избегать, и не копировать точные distinctive bot phrases без необходимости.
6. БД мержит memory deltas, supersede'ит конфликтующие single-value факты, не даёт self-memory переписать core persona, истекает volatile память и двигает курсор.
```

with:

```md
5. Summary prompt должен описывать повторяющиеся ошибки, loops и time mistakes как поведение, которого нужно избегать, и не копировать точные distinctive bot phrases без необходимости.
6. БД мержит participant memory deltas, supersede'ит конфликтующие single-value факты, истекает volatile память и двигает курсор.
```

- [ ] **Step 5: Update database model**

In the `participant_memories` section, replace:

```md
Тот же memory-layer используется и для chat-local self-memory бота, но summary не может писать туда `core`-факты или переписывать базовую persona-конфигурацию.
```

with:

```md
`participant_memories` используется для памяти об участниках. Bot self-memory больше не является продуктовым memory-layer; старые bot self-memory строки могут остаться в БД как rejected legacy data после production cleanup, но runtime не должен создавать новые строки и не должен использовать их в reply prompt.
```

- [ ] **Step 6: Verify docs**

Run:

```bash
rg -n "self-memory|selfMemory|selfMemoryUpdates|reply generation|bot self" docs/architecture.md
```

Expected: output states that bot self-memory is not used in reply generation and no longer generated by summary.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add docs/architecture.md
git commit -m "docs: remove bot self-memory from architecture"
```

Expected: commit succeeds.

### Task 5: Add Mandatory Production Data Repair

**Files:**
- Modify: `docs/development.md`
- Test: read-only SQL dry-run against `data/bot_copy.sqlite`

- [ ] **Step 1: Add production repair docs**

Append this section to `docs/development.md`:

````md
## Production SQLite Bot Self-Memory Repair

Run this only after deploying the code that removes bot self-memory from reply and summary paths.

Create a consistent backup from the server deploy directory:

```bash
sqlite3 data/bot.sqlite ".backup 'data/bot-before-self-memory-removal.sqlite'"
```

Dry-run the affected rows:

```bash
sqlite3 -readonly -header -column data/bot.sqlite \
  "SELECT memory_id, chat_id, user_id, memory_key, stability, status, value_text
   FROM participant_memories
   WHERE chat_id = -1002155313986
     AND user_id = 7378889635
   ORDER BY last_seen_at DESC;"
```

Repair the known poisoned data:

```bash
sqlite3 data/bot.sqlite <<'SQL'
BEGIN;

UPDATE participant_memories
SET status = 'rejected',
    last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE chat_id = -1002155313986
  AND user_id = 7378889635
  AND status = 'active';

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

sqlite3 -readonly -header -column data/bot.sqlite \
  "SELECT chat_id, user_id, profile_summary_text, profile_updated_at
   FROM chat_participants
   WHERE chat_id = -1002155313986
     AND user_id = 7378889635;"
```
````

- [ ] **Step 2: Dry-run against the copied database**

Run:

```bash
sqlite3 -readonly -header -column "file:data/bot_copy.sqlite?immutable=1" \
  "SELECT memory_id, chat_id, user_id, memory_key, stability, status, value_text
   FROM participant_memories
   WHERE chat_id = -1002155313986
     AND user_id = 7378889635
   ORDER BY last_seen_at DESC;"
```

Expected: output includes active rows `recurring_joke_with_oleg`, `response_loop`, `cat_metaphor_pattern`, and `time_zone_confusion`.

- [ ] **Step 3: Commit Task 5**

Run:

```bash
git add docs/development.md
git commit -m "docs: add bot self-memory production repair"
```

Expected: commit succeeds.

### Task 6: Final Verification And Manual Probe

**Files:**
- No additional source changes beyond Tasks 1-5.
- Runtime: production Docker Compose deployment.

- [ ] **Step 1: Run full local verification**

Run:

```bash
npm test
npm run typecheck
npm run build
rg -n "selfMemoryContext|Chat-local self memory|selfMemoryUpdates|BotSelfMemoryUpdate" src tests
```

Expected: all npm commands pass and `rg` prints no matches.

- [ ] **Step 2: Deploy**

Use the repository's existing deploy flow. For the local compose setup:

```bash
npm run build
docker compose --env-file .env -f compose.yml up -d --force-recreate bot
```

For the server compose setup after publishing the image, run from the server deploy directory:

```bash
docker compose --env-file .env -f compose.yml up -d --force-recreate bot
```

Expected: bot process restarts on code that no longer references bot self-memory.

- [ ] **Step 3: Run production data repair**

From the server deploy directory, run the backup and repair SQL documented in `docs/development.md`.

Expected: Khryupa's active self-memory rows become `rejected`, Khryupa's `chat_participants.profile_summary_text` is `NULL`, and main chat `chats.summary_text` is `NULL`.

- [ ] **Step 4: Manual Telegram probe**

Send one mention:

```text
@hrupa_bot ну что скажешь?
```

Reply to the bot's answer:

```text
что щас в чате происходит?
```

Expected: the bot does not reuse distinctive poisoned phrases such as `ведро`, `кот`, or `пасхальный хаос`. If it repeats anyway, inspect the new prompt before making another fix:

```bash
docker compose --env-file .env -f compose.yml logs --tail=200 bot
```

- [ ] **Step 5: Commit any verification-only docs correction**

If the manual probe reveals only a documentation mismatch, update docs and commit:

```bash
git add docs/architecture.md docs/development.md
git commit -m "docs: update bot loop verification notes"
```

Expected: source changes are not mixed into this docs-only correction.
