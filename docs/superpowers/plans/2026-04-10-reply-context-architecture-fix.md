# Reply Context Architecture Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove self-priming loops in `reply_to_bot` by storing explicit reply links and building a causal reply context instead of feeding the LLM a flat recent-message window.

**Architecture:** Keep the current direct-trigger policy (`mention` and `reply_to_bot` still always answer), but change the data path under it. Persist `reply_to_message_id` end-to-end, add a dedicated reply-context builder that can recover the exact bot message being answered plus a small amount of nearby human context, then switch prompt assembly to consume that structured bundle. Once the causal context exists, delete the temporary anti-loop prompt/system tweaks so the fix lives in architecture rather than wording.

**Tech Stack:** TypeScript, Vitest, SQLite via `better-sqlite3`, grammY Telegram updates

---

### Task 1: Persist Explicit Reply Links End-To-End

**Files:**
- Modify: `src/domain/models.ts`
- Modify: `src/transport/telegram/normalize-message.ts`
- Modify: `src/storage/database.ts`
- Modify: `tests/storage-database.test.ts`
- Test: `tests/storage-database.test.ts`

- [ ] **Step 1: Write the failing storage test**

```ts
test("persists reply_to_message_id on incoming and bot messages", () => {
  const db = DatabaseClient.open(":memory:");

  db.saveIncomingMessage({
    chatId: 1,
    chatType: "group",
    chatTitle: "Friends",
    messageId: 10,
    text: "первое сообщение",
    createdAt: "2026-04-10T12:00:00.000Z",
    fromUserId: 42,
    fromUsername: "tom",
    fromFirstName: "Tom",
    fromLastName: null,
    fromDisplayName: "Tom",
    isBot: false,
    entities: [],
    replyToUserId: null,
    replyToMessageId: null
  });

  db.saveIncomingMessage({
    chatId: 1,
    chatType: "group",
    chatTitle: "Friends",
    messageId: 11,
    text: "ответ на первое",
    createdAt: "2026-04-10T12:00:10.000Z",
    fromUserId: 99,
    fromUsername: "oleg",
    fromFirstName: "Олег",
    fromLastName: null,
    fromDisplayName: "Олег (@oleg)",
    isBot: false,
    entities: [],
    replyToUserId: 42,
    replyToMessageId: 10
  });

  db.saveBotMessage({
    chatId: 1,
    chatType: "group",
    chatTitle: "Friends",
    messageId: 12,
    text: "бот ответил",
    createdAt: "2026-04-10T12:00:20.000Z",
    userId: 77,
    username: "fun_bot",
    displayName: "Fun Bot",
    replyToMessageId: 11
  });

  expect(db.getMessageByTelegramMessageId(1, 11)).toMatchObject({
    messageId: 11,
    replyToMessageId: 10
  });
  expect(db.getMessageByTelegramMessageId(1, 12)).toMatchObject({
    messageId: 12,
    replyToMessageId: 11
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage-database.test.ts -t "persists reply_to_message_id on incoming and bot messages"`
Expected: FAIL because `NormalizedMessage` / `StoredMessage` do not expose `replyToMessageId`, the schema has no `reply_to_telegram_message_id`, and `getMessageByTelegramMessageId` does not exist yet.

- [ ] **Step 3: Implement minimal type, normalization, and storage support**

```ts
export type NormalizedMessage = {
  // ...
  replyToUserId: number | null;
  replyToMessageId: number | null;
};

export type StoredMessage = {
  // ...
  isBot: boolean;
  replyToMessageId: number | null;
};
```

```ts
return {
  // ...
  replyToUserId: message.reply_to_message?.from?.id ?? null,
  replyToMessageId: message.reply_to_message?.message_id ?? null
};
```

```sql
ALTER TABLE messages ADD COLUMN reply_to_telegram_message_id INTEGER;
```

```ts
getMessageByTelegramMessageId(chatId: number, messageId: number): StoredMessage | null {
  const row = this.db.prepare(`
    SELECT
      chat_id AS chatId,
      telegram_message_id AS messageId,
      user_id AS userId,
      sender_display_name AS senderDisplayName,
      text,
      created_at AS createdAt,
      is_bot AS isBot,
      reply_to_telegram_message_id AS replyToMessageId
    FROM messages
    WHERE chat_id = ? AND telegram_message_id = ?
  `).get(chatId, messageId);

  return row ? { ...row, isBot: Boolean(row.isBot) } : null;
}
```

- [ ] **Step 4: Run the focused storage test**

Run: `npx vitest run tests/storage-database.test.ts -t "persists reply_to_message_id on incoming and bot messages"`
Expected: PASS

- [ ] **Step 5: Add one normalization assertion**

```ts
expect(normalizeTextMessage(ctx)).toMatchObject({
  replyToUserId: 77,
  replyToMessageId: 345
});
```

- [ ] **Step 6: Run the related suites**

Run: `npx vitest run tests/storage-database.test.ts tests/response-policy.test.ts tests/app.test.ts`
Expected: PASS with reply detection still working and no regression from the schema migration.

- [ ] **Step 7: Commit**

```bash
git add src/domain/models.ts src/transport/telegram/normalize-message.ts src/storage/database.ts tests/storage-database.test.ts tests/app.test.ts
git commit -m "feat: persist telegram reply message links"
```

### Task 2: Introduce A Dedicated Reply Context Builder

**Files:**
- Create: `src/app/reply-context-builder.ts`
- Modify: `src/domain/models.ts`
- Modify: `src/storage/database.ts`
- Create: `tests/reply-context-builder.test.ts`
- Test: `tests/reply-context-builder.test.ts`

- [ ] **Step 1: Write the failing builder test for `reply_to_bot`**

```ts
test("builds causal reply context for reply_to_bot without replaying the whole bot loop", () => {
  const db = new FakeDatabaseClient();

  db.seedStoredMessages(1, [
    { messageId: 100, userId: 42, senderDisplayName: "Tom", text: "ну чо", isBot: false, replyToMessageId: null, createdAt: "2026-04-10T12:00:00.000Z", chatId: 1 },
    { messageId: 101, userId: 77, senderDisplayName: "Хрюпа", text: "какой-то странный ответ про кота", isBot: true, replyToMessageId: 100, createdAt: "2026-04-10T12:00:05.000Z", chatId: 1 },
    { messageId: 102, userId: 126, senderDisplayName: "Хачик", text: "почему кот", isBot: false, replyToMessageId: 101, createdAt: "2026-04-10T12:00:10.000Z", chatId: 1 }
  ]);

  const context = buildReplyContext({
    db,
    chatId: 1,
    triggerMessageId: 102,
    reason: "reply_to_bot",
    messageContextLimit: 16
  });

  expect(context.triggerMessage?.messageId).toBe(102);
  expect(context.anchorBotMessage?.messageId).toBe(101);
  expect(context.anchorParentMessage?.messageId).toBe(100);
  expect(context.transcriptMessages.map((message) => message.messageId)).toEqual([100, 101, 102]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reply-context-builder.test.ts -t "builds causal reply context for reply_to_bot without replaying the whole bot loop"`
Expected: FAIL because there is no builder module, no `triggerMessageId` plumbing, and no DB helper methods for anchor lookup.

- [ ] **Step 3: Define the structured reply-context types**

```ts
export type ReplyContext = {
  triggerMessage: StoredMessage | null;
  anchorBotMessage: StoredMessage | null;
  anchorParentMessage: StoredMessage | null;
  transcriptMessages: StoredMessage[];
};
```

```ts
export function buildReplyContext(input: {
  db: Pick<DatabaseClient,
    "getMessageByTelegramMessageId" |
    "getMessagesBefore"
  >;
  chatId: number;
  triggerMessageId: number;
  reason: "mention" | "reply_to_bot" | "direct_message" | "interjection";
  messageContextLimit: number;
}): ReplyContext {
  // fetch trigger -> fetch replied-to bot message -> fetch parent human message
  // for non-reply_to_bot fall back to recent window assembly
}
```

- [ ] **Step 4: Add the minimal storage helper for ordered lookback**

```ts
getMessagesBefore(chatId: number, beforeMessageId: number, limit: number): StoredMessage[] {
  const rows = this.db.prepare(`
    SELECT
      chat_id AS chatId,
      telegram_message_id AS messageId,
      user_id AS userId,
      sender_display_name AS senderDisplayName,
      text,
      created_at AS createdAt,
      is_bot AS isBot,
      reply_to_telegram_message_id AS replyToMessageId
    FROM messages
    WHERE chat_id = ? AND telegram_message_id < ?
    ORDER BY telegram_message_id DESC
    LIMIT ?
  `).all(chatId, beforeMessageId, limit);

  return rows.reverse().map((row) => ({ ...row, isBot: Boolean(row.isBot) }));
}
```

- [ ] **Step 5: Run the builder suite**

Run: `npx vitest run tests/reply-context-builder.test.ts`
Expected: PASS

- [ ] **Step 6: Add one fallback test for non-reply triggers**

```ts
expect(context.anchorBotMessage).toBeNull();
expect(context.transcriptMessages.at(-1)?.messageId).toBe(triggerMessageId);
```

- [ ] **Step 7: Run both builder and orchestrator tests**

Run: `npx vitest run tests/reply-context-builder.test.ts tests/chat-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/app/reply-context-builder.ts src/domain/models.ts src/storage/database.ts tests/reply-context-builder.test.ts tests/chat-orchestrator.test.ts
git commit -m "feat: add causal reply context builder"
```

### Task 3: Rewire Orchestrator And Prompt Assembly To Use Structured Reply Context

**Files:**
- Modify: `src/app/chat-job-coordinator.ts`
- Modify: `src/app/chat-orchestrator.ts`
- Modify: `src/llm/prompts.ts`
- Modify: `tests/chat-orchestrator.test.ts`
- Modify: `tests/llm-prompts.test.ts`
- Test: `tests/chat-orchestrator.test.ts`
- Test: `tests/llm-prompts.test.ts`

- [ ] **Step 1: Write the failing orchestrator test for causal prompt input**

```ts
test("passes trigger text into social analysis and structured reply context into prompt generation", async () => {
  const db = new FakeDatabaseClient();

  db.seedStoredMessages(1, [
    { chatId: 1, messageId: 10, userId: 42, senderDisplayName: "Tom", text: "ну чо", createdAt: "2026-04-10T12:00:00.000Z", isBot: false, replyToMessageId: null },
    { chatId: 1, messageId: 11, userId: 77, senderDisplayName: "Хрюпа", text: "кривой ответ", createdAt: "2026-04-10T12:00:05.000Z", isBot: true, replyToMessageId: 10 },
    { chatId: 1, messageId: 12, userId: 126, senderDisplayName: "Хачик", text: "почему кот", createdAt: "2026-04-10T12:00:10.000Z", isBot: false, replyToMessageId: 11 }
  ]);

  await orchestrator.handleIncomingMessage(createIncomingMessage({
    messageId: 12,
    text: "почему кот",
    replyToUserId: 77,
    replyToMessageId: 11
  }));

  expect(generateReply).toHaveBeenCalledWith(
    expect.objectContaining({
      replyContext: expect.objectContaining({
        triggerMessage: expect.objectContaining({ messageId: 12 }),
        anchorBotMessage: expect.objectContaining({ messageId: 11 }),
        anchorParentMessage: expect.objectContaining({ messageId: 10 })
      }),
      socialIntentReason: null
    })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/chat-orchestrator.test.ts -t "passes trigger text into social analysis and structured reply context into prompt generation"`
Expected: FAIL because the orchestrator still requests `recentMessages` and derives social intent from the last item in that flat array.

- [ ] **Step 3: Rename the pending reply identifiers so intent is unambiguous**

```ts
export type PendingReplyRequest = {
  chatId: number;
  chatType: ChatType;
  chatTitle: string | null;
  triggerMessageId: number;
  triggerReplyToMessageId: number | null;
  fromUserId: number | null;
  fromDisplayName: string;
  createdAt: string;
  reason: ReplyReason;
};
```

```ts
return {
  chatId: message.chatId,
  chatType: message.chatType,
  chatTitle: message.chatTitle,
  triggerMessageId: message.messageId,
  triggerReplyToMessageId: message.replyToMessageId,
  fromUserId: message.fromUserId,
  fromDisplayName: message.fromDisplayName,
  createdAt: message.createdAt,
  reason
};
```

- [ ] **Step 4: Switch orchestrator logic to the builder output**

```ts
const replyContext = buildReplyContext({
  db: this.deps.db,
  chatId: request.chatId,
  triggerMessageId: request.triggerMessageId,
  reason: request.reason,
  messageContextLimit: this.deps.env.messageContextLimit
});

const triggerText = replyContext.triggerMessage?.text ?? "";
const socialIntent = detectSocialIntent(triggerText);
const resolution = this.resolveParticipantsForReply(request.chatId, triggerText);
```

- [ ] **Step 5: Replace the flat transcript prompt contract**

```ts
return [
  "Global persona:",
  input.persona,
  "",
  "Current message:",
  formatSingleMessage(input.replyContext.triggerMessage),
  "",
  "Message of yours being replied to:",
  formatSingleMessage(input.replyContext.anchorBotMessage),
  "",
  "Earlier human context:",
  formatReplyContextMessages(input.replyContext.transcriptMessages)
].join("\n");
```

- [ ] **Step 6: Run the focused suites**

Run: `npx vitest run tests/chat-orchestrator.test.ts tests/llm-prompts.test.ts`
Expected: PASS with prompt tests asserting the new named sections and orchestrator tests asserting causal assembly.

- [ ] **Step 7: Commit**

```bash
git add src/app/chat-job-coordinator.ts src/app/chat-orchestrator.ts src/llm/prompts.ts tests/chat-orchestrator.test.ts tests/llm-prompts.test.ts
git commit -m "refactor: use causal reply context for llm prompts"
```

### Task 4: Remove The Temporary Prompt Hotfixes And Lock The Regression

**Files:**
- Modify: `src/llm/prompts.ts`
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Modify: `tests/llm-prompts.test.ts`
- Modify: `tests/openai-compatible-llm-client.test.ts`
- Modify: `docs/architecture.md`
- Test: `tests/llm-prompts.test.ts`
- Test: `tests/openai-compatible-llm-client.test.ts`

- [ ] **Step 1: Write the failing regression test that expects the hotfix strings to be gone**

```ts
test("reply prompt relies on structured context instead of anti-loop warning text", () => {
  const prompt = buildReplyPrompt({
    persona: "Ты Хрюпа",
    chatSummary: null,
    selfMemoryContext: null,
    participantMemoryContext: null,
    socialIntent: false,
    socialIntentReason: null,
    resolvedParticipants: [],
    socialParticipantContexts: [],
    targetDisplayName: "Хачик",
    reason: "reply_to_bot",
    replyContext: {
      triggerMessage: null,
      anchorBotMessage: null,
      anchorParentMessage: null,
      transcriptMessages: []
    }
  });

  expect(prompt).not.toContain("If people question or mock one of your earlier metaphors");
  expect(prompt).not.toContain('Do not fall into repeated reply templates like "<name>, ты как..."');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/llm-prompts.test.ts -t "reply prompt relies on structured context instead of anti-loop warning text"`
Expected: FAIL because the temporary anti-loop strings are still present.

- [ ] **Step 3: Delete the temporary prompt/system tweaks and restore neutral LLM settings**

```ts
// remove the temporary anti-loop lines from buildReplyPrompt(...)
```

```ts
temperature: 0.9,
messages: [
  {
    role: "system",
    content:
      "You are a Telegram group chat character. Stay in character, answer naturally, and do not break the fourth wall."
  }
]
```

- [ ] **Step 4: Document the new invariant**

```md
- reply generation must prefer causal reply context over a flat recent-message window when the trigger is `reply_to_bot`;
- temporary anti-loop prompt wording is not a supported architectural safeguard and should not be reintroduced as the primary fix.
```

- [ ] **Step 5: Run the focused rollback/regression suites**

Run: `npx vitest run tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts`
Expected: PASS with the hotfix-specific assertions removed or inverted.

- [ ] **Step 6: Run the broader safety suite**

Run: `npm test -- tests/storage-database.test.ts tests/reply-context-builder.test.ts tests/chat-orchestrator.test.ts tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/llm/prompts.ts src/llm/openai-compatible-llm-client.ts tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts docs/architecture.md
git commit -m "refactor: remove prompt anti-loop workaround"
```

### Task 5: Final Verification And Manual Replay Checks

**Files:**
- Modify: `docs/superpowers/plans/2026-04-10-reply-context-architecture-fix.md`
- Test: `npm test`

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: PASS with all Vitest suites green.

- [ ] **Step 2: Capture one local replay scenario in notes**

Use this manual transcript probe after implementation:

```text
Tom: @hrupa_bot ну чо?
Хрюпа: [deliberately odd reply]
Хачик: почему кот?
Хачик -> reply to bot: да при чем тут кот
```

Expected:
- the second reply sees the exact bot message being challenged;
- prompt context includes the challenged bot message and its parent human message;
- the prompt does not include an unrelated chain of older bot replies as equal-weight context.

- [ ] **Step 3: Record verification outcome in the plan notes**

```md
- [ ] Full test suite passed
- [ ] Manual reply-loop probe completed
- [ ] Temporary anti-loop prompt patch removed
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-04-10-reply-context-architecture-fix.md
git commit -m "docs: record reply context verification plan"
```

## Self-Review

- **Spec coverage:** The plan covers reply-link persistence, causal reply-context assembly, orchestrator rewiring, prompt contract changes, rollback of the temporary prompt workaround, and verification.
- **Placeholder scan:** No `TODO`/`TBD` placeholders remain; each task names exact files, tests, commands, and target code shapes.
- **Type consistency:** The plan consistently uses `replyToMessageId` for persisted message links and `triggerMessageId` / `triggerReplyToMessageId` for pending reply jobs to avoid the current naming ambiguity.

## Verification Notes

- [x] Full test suite passed: `npm test` -> 17 files passed, 86 tests passed.
- [x] TypeScript check passed: `npm run typecheck` -> `tsc --noEmit` exited 0.
- [x] Temporary anti-loop prompt patch removed from reply prompt and neutral reply client settings restored.
- [x] Causal reply-context path covered by automated tests, including the degraded `reply_to_bot` case where the anchor bot message is present but its parent message is missing.
- [ ] Manual Telegram reply-loop probe not run in this local coding session; run after deploy or with a live bot token.
