# Evidence Bound Social QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make participant-description answers use the existing social layer instead of hallucinating personality traits when participant memory is empty.

**Architecture:** Keep the MVP-1 social layer: deterministic participant alias resolution, social intent detection, and participant memory bundles. Extend it so "опиши X / что скажешь про X / расскажи про X" is explicitly social QA, and make the reply prompt evidence-bound: claims about resolved participants must be grounded in stored participant memory or clearly visible fresh context. If no stored memory exists, the bot should say it has not figured the person out yet instead of inventing stable traits.

**Tech Stack:** TypeScript, Vitest, SQLite via `better-sqlite3`, OpenAI-compatible chat completions

---

## Why This Should Help

The social layer exists, but the live logs show it has no evidence for the requested people:

```text
Resolved participants:
- user#126687103 Хачик (@loudsplash)

Participant social context bundle:
- user#126687103 Хачик (@loudsplash): No stored participant memory.
```

With no stored memory and no evidence-bound instruction, the LLM invents descriptions from vibes: "буржуй", "Гёте", "главный герой". This plan does not pretend memory already exists. It makes "no memory" a first-class condition in the reply contract and expands social intent detection so participant-description requests route through the social QA path.

Out of scope:

- No reply style normalizer.
- No time grounding.
- No post-generation anchor echo guard.
- No new long-term memory engine beyond the existing summary/memory pipeline.

---

### Task 1: Detect Participant Description Requests As Social QA

**Files:**
- Modify: `src/domain/models.ts`
- Modify: `src/domain/social-intent.ts`
- Modify: `tests/domain/social-intent.test.ts`

- [x] **Step 1: Write failing social-intent tests**

Add to `tests/domain/social-intent.test.ts`:

```ts
test("detects participant description requests", () => {
  expect(detectSocialIntent("опиши Хачика")).toEqual({
    isSocialQa: true,
    reason: "participant_description_request"
  });
  expect(detectSocialIntent("что скажешь про Артура?")).toEqual({
    isSocialQa: true,
    reason: "participant_description_request"
  });
  expect(detectSocialIntent("@hrupa_bot расскажи про Олега")).toEqual({
    isSocialQa: true,
    reason: "participant_description_request"
  });
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npx vitest run tests/domain/social-intent.test.ts -t "detects participant description requests"
```

Expected: FAIL because `participant_description_request` is not part of `SocialIntentReason` and the patterns do not detect description requests yet.

- [x] **Step 3: Extend the social intent type**

Modify `src/domain/models.ts`:

```ts
export type SocialIntentReason =
  | "relationship_question"
  | "support_question"
  | "participant_status_question"
  | "participant_description_request";
```

- [x] **Step 4: Add description request patterns**

Modify `src/domain/social-intent.ts`:

```ts
const PARTICIPANT_DESCRIPTION_PATTERNS = [
  /\bопиши\s+/i,
  /\bрасскажи\s+про\s+/i,
  /\bчто\s+скаж(?:ешь|ете)\s+про\s+/i,
  /\bчто\s+можешь\s+сказать\s+про\s+/i
];
```

Then check these before the broad `PARTICIPANT_STATUS_PATTERNS`:

```ts
if (PARTICIPANT_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(text))) {
  return {
    isSocialQa: true,
    reason: "participant_description_request"
  };
}
```

- [x] **Step 5: Run social intent tests**

Run:

```bash
npx vitest run tests/domain/social-intent.test.ts
```

Expected: PASS. Existing non-social trigger `@fun_bot расскажи анекдот` must remain non-social because it does not match `расскажи про`.

- [x] **Step 6: Commit**

```bash
git add src/domain/models.ts src/domain/social-intent.ts tests/domain/social-intent.test.ts
git commit -m "feat: detect participant description intent"
```

### Task 2: Surface Evidence Boundaries In Reply Prompts

**Files:**
- Modify: `src/llm/prompts.ts`
- Modify: `tests/llm-prompts.test.ts`

- [x] **Step 1: Write failing prompt contract test**

Add to `tests/llm-prompts.test.ts`:

```ts
test("warns participant descriptions against inventing traits without stored memory", () => {
  const prompt = buildReplyPrompt({
    persona: "Ты Хрюпа",
    chatSummary: null,
    selfMemoryContext: null,
    participantMemoryContext: null,
    socialIntent: true,
    socialIntentReason: "participant_description_request",
    resolvedParticipants: [
      { userId: 126, displayName: "Хачик (@loudsplash)" }
    ],
    socialParticipantContexts: [
      {
        userId: 126,
        displayName: "Хачик (@loudsplash)",
        participantMemoryContext: null
      }
    ],
    targetDisplayName: "Артём (@artyomwebdev)",
    reason: "mention",
    replyContext: {
      triggerMessage: {
        chatId: 1,
        messageId: 35045,
        userId: 84626969,
        senderDisplayName: "Артём (@artyomwebdev)",
        text: "@hrupa_bot опиши Хачика",
        createdAt: "2026-04-10T20:22:32.000Z",
        isBot: false,
        replyToMessageId: null
      },
      anchorBotMessage: null,
      anchorParentMessage: null,
      priorContextMessages: []
    }
  });

  expect(prompt).toContain("Participant description evidence rules:");
  expect(prompt).toContain("Do not invent stable traits, background, relationships, or habits for resolved participants.");
  expect(prompt).toContain("No stored participant memory. Treat this participant as not well known yet.");
});
```

- [x] **Step 2: Run the focused prompt test to verify it fails**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts -t "warns participant descriptions against inventing traits without stored memory"
```

Expected: FAIL because the prompt currently renders `No stored participant memory.` without any evidence-bound instruction.

- [x] **Step 3: Add participant description evidence rules to reply prompts**

Modify `src/llm/prompts.ts` near the `Participant social context bundle` section:

```ts
"Participant social context bundle:",
formatSocialParticipantContexts(input.socialParticipantContexts),
"",
"Participant description evidence rules:",
formatParticipantDescriptionEvidenceRules(input),
"",
"Current message:",
```

Add helper:

```ts
function formatParticipantDescriptionEvidenceRules(input: {
  socialIntentReason: string | null;
  resolvedParticipants: Array<{ userId: number; displayName: string }>;
  socialParticipantContexts: Array<{
    userId: number;
    displayName: string;
    participantMemoryContext: string | null;
  }>;
}): string {
  if (
    input.socialIntentReason !== "participant_description_request" ||
    input.resolvedParticipants.length === 0
  ) {
    return "No participant description request detected.";
  }

  const missingMemory = input.socialParticipantContexts
    .filter((context) => context.participantMemoryContext === null)
    .map((context) => sanitizePromptText(context.displayName));

  const missingMemoryLine =
    missingMemory.length === 0
      ? "All resolved participants have stored memory context."
      : `No stored participant memory for: ${missingMemory.join(", ")}. Treat these participants as not well known yet.`;

  return [
    "Do not invent stable traits, background, relationships, or habits for resolved participants.",
    "Base participant descriptions only on stored participant memory and clearly visible fresh chat context.",
    "If stored memory is missing, say that you have not figured the person out yet and keep any observation tentative.",
    missingMemoryLine
  ].join("\n");
}
```

- [x] **Step 4: Strengthen missing-memory rendering**

Modify `formatSocialParticipantContexts(...)` in `src/llm/prompts.ts` so null memory is explicit:

```ts
const memoryContext =
  context.participantMemoryContext ??
  "No stored participant memory. Treat this participant as not well known yet.";
```

Then use `memoryContext` in the mapped line.

- [x] **Step 5: Run prompt tests**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts
```

Expected: PASS. Existing tests that check `No stored participant memory.` should still pass because the phrase remains present as a prefix.

- [x] **Step 6: Commit**

```bash
git add src/llm/prompts.ts tests/llm-prompts.test.ts
git commit -m "fix: bound participant descriptions to evidence"
```

### Task 3: Verify Orchestrator Social QA Wiring For Description Requests

**Files:**
- Modify: `tests/chat-orchestrator.test.ts`

- [x] **Step 1: Write failing orchestrator test for `опиши X`**

Add to `tests/chat-orchestrator.test.ts`:

```ts
test("passes participant description requests through the social QA context path", async () => {
  const db = new FakeDatabaseClient();

  db.seedParticipantAliases(1, "хачика", [
    createAliasRecord(1, 126, "Хачик", "Хачик (@loudsplash)")
  ]);

  const generateReply = vi.fn().mockResolvedValue(createReplyResult("пока не раскусил"));
  const orchestrator = createOrchestrator({
    db,
    qwen: {
      generateReply,
      summarizeConversation: vi.fn().mockResolvedValue(createSummaryResult("summary"))
    },
    replyDispatcher: vi.fn().mockResolvedValue({
      messageId: 1006,
      createdAt: "2026-04-03T12:10:00.000Z"
    })
  });

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      messageId: 4,
      text: "@fun_bot опиши Хачика",
      entities: [{ type: "mention", offset: 0, length: 8 }]
    })
  );

  expect(generateReply).toHaveBeenCalledWith(
    expect.objectContaining({
      socialIntent: true,
      socialIntentReason: "participant_description_request",
      resolvedParticipants: [
        { userId: 126, displayName: "Хачик (@loudsplash)" }
      ],
      socialParticipantContexts: [
        {
          userId: 126,
          displayName: "Хачик (@loudsplash)",
          participantMemoryContext: null
        }
      ]
    })
  );
});
```

- [x] **Step 2: Run the focused orchestrator test to verify it fails before Task 1 is applied**

If Task 1 has already been applied, this test may pass immediately. If running strictly red-green before Task 1, run:

```bash
npx vitest run tests/chat-orchestrator.test.ts -t "passes participant description requests through the social QA context path"
```

Expected before Task 1: FAIL with `socialIntent: false` or a mismatched `socialIntentReason`.

- [x] **Step 3: Run the focused orchestrator test after Task 1**

Run:

```bash
npx vitest run tests/chat-orchestrator.test.ts -t "passes participant description requests through the social QA context path"
```

Expected after Task 1: PASS.

- [x] **Step 4: Commit**

```bash
git add tests/chat-orchestrator.test.ts
git commit -m "test: cover participant description social path"
```

### Task 4: Document The Social QA Evidence Invariant

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/superpowers/plans/2026-04-10-evidence-bound-social-qa.md`

- [x] **Step 1: Update architecture invariants**

Add to `docs/architecture.md` under `Product Invariants`:

```md
- social-QA answers about participants must be evidence-bound: when stored participant memory is missing, the bot must not invent stable personality traits, background, relationships, or habits; it may only make tentative observations from visible fresh context.
```

- [x] **Step 2: Run full verification**

Run:

```bash
npm test
npm run typecheck
```

Expected:

```text
Test Files  17 passed
Tests       90+ passed
tsc --noEmit exits 0
```

The exact test count can be higher after the new tests.

- [x] **Step 3: Commit docs**

```bash
git add docs/architecture.md docs/superpowers/plans/2026-04-10-evidence-bound-social-qa.md
git commit -m "docs: plan evidence-bound social qa"
```

---

## Manual Telegram Probe After Deploy

After deploy, use a chat participant with no stored memory and ask:

```text
@hrupa_bot опиши Хачика
@hrupa_bot что скажешь про Артура?
@hrupa_bot расскажи про Олега
```

Expected:

- `Social intent` is `participant_description_request`.
- `Resolved participants` contains the requested participant.
- If `Participant social context bundle` says no stored memory, the reply should not invent stable labels like "буржуй", "пишет стихи", "главный герой", or other biographical/personality claims.
- A good no-memory answer is short and tentative, for example: "Пока не раскусил его нормально, по свежему чату вижу только что он вкидывает сухо и с подъёбом".
