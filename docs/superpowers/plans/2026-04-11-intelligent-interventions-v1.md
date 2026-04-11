# Intelligent Interventions V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace immediate random interjections with a conservative structured intervention decision layer for group chats.

**Architecture:** Keep direct `mention`, `reply_to_bot`, and private-message replies unchanged. For non-direct group messages, run the existing probability/cooldown as a cheap gate; only after it passes, analyze a recent message window with an LLM that returns structured decision data. If the model says to intervene, generate a normal persona reply with that decision included in the reply reason; before dispatch, drop the reply if newer messages arrived after the analyzed window.

**Tech Stack:** TypeScript, Vitest, zod, OpenAI-compatible chat completions, SQLite via `better-sqlite3`, grammY transport unchanged.

**Implementation Status:** Implemented in branch `intelligent-interventions-v1`. The plan intentionally did not add new environment variables, so `.env.example` and `deploy/.env.server.example` were left unchanged.

---

### Task 1: Domain Types And Prompt Builder

**Files:**
- Create: `src/domain/intervention-analysis.ts`
- Modify: `src/domain/models.ts`
- Modify: `src/llm/prompts.ts`
- Test: `tests/domain/intervention-analysis.test.ts`
- Test: `tests/llm-prompts.test.ts`

- [x] **Step 1: Write failing domain tests**

Add `tests/domain/intervention-analysis.test.ts` with tests for:

```ts
import { describe, expect, test } from "vitest";

import {
  isFreshInterventionDecision,
  shouldConsiderIntervention
} from "../../src/domain/intervention-analysis.js";

describe("intervention-analysis", () => {
  test("does not consider private chats or direct triggers for intervention analysis", () => {
    expect(shouldConsiderIntervention({ chatType: "private", directTrigger: "none", randomGatePassed: true })).toBe(false);
    expect(shouldConsiderIntervention({ chatType: "group", directTrigger: "mention", randomGatePassed: true })).toBe(false);
    expect(shouldConsiderIntervention({ chatType: "supergroup", directTrigger: "reply_to_bot", randomGatePassed: true })).toBe(false);
  });

  test("considers non-direct group messages only after the cheap random gate passes", () => {
    expect(shouldConsiderIntervention({ chatType: "group", directTrigger: "none", randomGatePassed: false })).toBe(false);
    expect(shouldConsiderIntervention({ chatType: "supergroup", directTrigger: "none", randomGatePassed: true })).toBe(true);
  });

  test("treats decisions as fresh only when no newer message is present", () => {
    expect(isFreshInterventionDecision({ analyzedThroughMessageId: 10, latestMessageId: 10 })).toBe(true);
    expect(isFreshInterventionDecision({ analyzedThroughMessageId: 10, latestMessageId: 11 })).toBe(false);
  });
});
```

- [x] **Step 2: Run domain tests and verify RED**

Run: `npx vitest run tests/domain/intervention-analysis.test.ts`
Expected: FAIL because `src/domain/intervention-analysis.ts` does not exist.

- [x] **Step 3: Implement domain module and types**

Add `InterventionDecision` and `InterventionGoal` to `src/domain/models.ts`; implement `shouldConsiderIntervention` and `isFreshInterventionDecision` in `src/domain/intervention-analysis.ts`.

- [x] **Step 4: Run domain tests and verify GREEN**

Run: `npx vitest run tests/domain/intervention-analysis.test.ts`
Expected: PASS.

- [x] **Step 5: Add prompt test for structured analysis**

In `tests/llm-prompts.test.ts`, add a test that `buildInterventionAnalysisPrompt` includes an untrusted transcript boundary, chat summary, recent messages, and the allowed goals `engage`, `deescalate`, `provoke`, `joke`, `support`.

- [x] **Step 6: Run prompt test and verify RED**

Run: `npx vitest run tests/llm-prompts.test.ts -t "intervention analysis prompt"`
Expected: FAIL because `buildInterventionAnalysisPrompt` is not implemented.

- [x] **Step 7: Implement prompt builder**

Add `buildInterventionAnalysisPrompt` to `src/llm/prompts.ts`. It must describe transcript content as untrusted data, ask for a single JSON object, and avoid persona wording.

- [x] **Step 8: Run prompt test and verify GREEN**

Run: `npx vitest run tests/llm-prompts.test.ts -t "intervention analysis prompt"`
Expected: PASS.

### Task 2: OpenAI-Compatible LLM Decision Method

**Files:**
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Test: `tests/openai-compatible-llm-client.test.ts`

- [x] **Step 1: Write failing LLM-client tests**

Add tests that `analyzeIntervention` calls the summary model with low temperature, parses JSON into an `InterventionDecision`, defaults invalid optional fields conservatively, and rejects malformed decisions.

- [x] **Step 2: Run focused test and verify RED**

Run: `npx vitest run tests/openai-compatible-llm-client.test.ts -t "intervention"`
Expected: FAIL because `analyzeIntervention` does not exist.

- [x] **Step 3: Implement schema and method**

Add a zod schema for `InterventionDecision`, import `buildInterventionAnalysisPrompt`, call the existing retry wrapper, parse with `extractJsonObject`, and return the parsed decision plus model metadata.

- [x] **Step 4: Run focused test and verify GREEN**

Run: `npx vitest run tests/openai-compatible-llm-client.test.ts -t "intervention"`
Expected: PASS.

### Task 3: Orchestrator Flow And Fresh-Or-Drop

**Files:**
- Modify: `src/app/chat-orchestrator.ts`
- Modify: `src/app/chat-job-coordinator.ts`
- Test: `tests/chat-orchestrator.test.ts`
- Test: `tests/chat-job-coordinator.test.ts`

- [x] **Step 1: Write failing orchestrator tests**

Add tests proving that a random-gated non-direct group message first calls `analyzeIntervention`, only calls `generateReply` when `shouldIntervene` is true, passes the structured decision through the reply reason, and drops the reply when a newer message exists after the analyzed window.

- [x] **Step 2: Run focused orchestrator tests and verify RED**

Run: `npx vitest run tests/chat-orchestrator.test.ts -t "intervention"`
Expected: FAIL because the orchestrator still treats random interjections as immediate replies.

- [x] **Step 3: Extend job coordinator if needed**

Add an `analyzing_intervention` phase only if the orchestrator needs to prevent reply/summary overlap while analysis is running. Keep pending direct replies higher priority than intervention replies.

- [x] **Step 4: Implement orchestrator path**

For `directTrigger === "none"` in group chats, treat `shouldInterject` as a cheap analysis gate. Build the analyzed window from recent messages ending at the trigger message, call `qwen.analyzeIntervention`, log the decision, and only enqueue/run a reply when the decision says `shouldIntervene: true`. Before dispatch, compare the latest message id with `analyzedThroughMessageId`; if newer messages exist, log and drop.

- [x] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run tests/chat-orchestrator.test.ts tests/chat-job-coordinator.test.ts -t "intervention|prefers"`
Expected: PASS.

### Task 4: Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`
- Modify: `docs/todo/intelligent-interventions.md`

- [x] **Step 1: Update docs**

Document that random interjections now mean “candidate analysis gate” rather than guaranteed reply, and preserve the invariant that dry analysis is separate from persona reply generation.

- [x] **Step 2: Run targeted verification**

Run:

```bash
npx vitest run tests/domain/intervention-analysis.test.ts tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts tests/chat-job-coordinator.test.ts tests/chat-orchestrator.test.ts
```

Expected: PASS.

- [x] **Step 3: Run full verification**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Do not commit unless requested**

Leave changes in the working tree and summarize verification output for the user.
