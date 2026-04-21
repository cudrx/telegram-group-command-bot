# Media Context Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `read`, `explain`, `decide`, and `answer` reuse cached media analysis, add image-specific `vision_raw` and `vision_interpretation`, and make `answer` use `ANSWER_CONTEXT_LIMIT` plus nearby media context.

**Architecture:** Keep the existing provider artifact cache in `media_artifacts`, but add a second image layer: `vision_raw` for the raw Cloudflare prose response and `vision_interpretation` for the DeepSeek interpretation that becomes the shared image context for all modes. `explain`, `decide`, and `answer` continue to be single-target modes, but they gain access to target media plus a small nearby-media scan window of 10 prior messages.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, Telegram bot orchestration, Cloudflare Vision, DeepSeek via the existing LLM client

---

## File Map

- Modify: `src/config/env.ts`
  Add `ANSWER_CONTEXT_LIMIT` to runtime parsing and `AppEnv`.
- Modify: `src/app/chat-orchestrator.ts`
  Add the new image pipeline, target-media enrichment, nearby-media scan, and `ANSWER_CONTEXT_LIMIT` usage.
- Modify: `src/storage/database.ts`
  Reuse `media_artifacts` with new `artifact_kind` values and helper lookups for nearby media artifacts.
- Modify: `src/llm/prompts.ts`
  Extend media context payloads so `read`, `explain`, and `answer` can receive target media and nearby media context.
- Modify: `llm/reply/read.md`
  Reframe image `read` around interpreted image context, while still exposing `vision_raw`.
- Modify: `llm/reply/answer.md`
  Tell the model that the target message may continue the recent chat and that nearby context should be used to disambiguate when relevant.
- Modify: `llm/system/explain.md`
  Include media blocks for `explain` and `answer`, not just text-only target and transcript blocks.
- Modify: `src/media/cloudflare-vision-provider.ts`
  Replace the strict JSON prompt with the agreed minimal prose prompt.
- Test: `tests/env.test.ts`
  Add coverage for `ANSWER_CONTEXT_LIMIT`.
- Test: `tests/chat-orchestrator.test.ts`
  Add end-to-end orchestration coverage for target media, cached media, nearby media scan, and answer-context usage.
- Test: `tests/llm-prompts.test.ts`
  Add prompt-shape coverage for media-aware `explain` and `answer`.
- Test: `tests/storage-database.test.ts`
  Add coverage for new `artifact_kind` values and nearby-media lookup helpers.
- Optional doc follow-up after implementation: `docs/development.md`
  Update developer notes if runtime behavior or env vars materially change.

## Constants And Naming Decisions

- New env field: `ANSWER_CONTEXT_LIMIT`
- New hardcoded nearby media scan window: `10`
- New image artifact kinds:
  - `vision_raw`
  - `vision_interpretation`
- Existing audio/video provider artifacts remain:
  - `transcript`
  - `vision_structured` can remain temporarily for backward compatibility but should no longer be the primary image read input

## Task 1: Wire `ANSWER_CONTEXT_LIMIT`

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/app/chat-orchestrator.ts`
- Test: `tests/env.test.ts`

- [ ] **Step 1: Write the failing env test**

Add a test in `tests/env.test.ts` that passes `ANSWER_CONTEXT_LIMIT=34` and expects `parseEnv(...).answerContextLimit` to equal `34`.

- [ ] **Step 2: Run the env test to verify failure**

Run: `npm test -- tests/env.test.ts`
Expected: FAIL because `answerContextLimit` is not defined in `ParsedEnv`.

- [ ] **Step 3: Add env parsing**

Update `src/config/env.ts` to:
- add `ANSWER_CONTEXT_LIMIT` to `envSchema`
- add `answerContextLimit` to `ParsedEnv`
- return `answerContextLimit: parsed.ANSWER_CONTEXT_LIMIT`

- [ ] **Step 4: Switch `answer` to the new limit**

Update `getContextLimitForIntent(...)` in `src/app/chat-orchestrator.ts` so:
- `answer` uses `env.answerContextLimit`
- `explain` keeps using `env.explainContextLimit`

- [ ] **Step 5: Re-run the focused tests**

Run: `npm test -- tests/env.test.ts tests/chat-orchestrator.test.ts`
Expected: PASS for the new env test, with existing `answer` tests still green.

## Task 2: Replace strict Cloudflare image extraction with raw prose capture

**Files:**
- Modify: `src/media/cloudflare-vision-provider.ts`
- Test: `tests/app.test.ts`

- [ ] **Step 1: Write the failing provider wiring test**

Add or update a test in `tests/app.test.ts` that asserts the image provider still wires correctly after the request-body change.

- [ ] **Step 2: Run the provider wiring test to verify the current contract**

Run: `npm test -- tests/app.test.ts`
Expected: PASS before editing, giving a safe baseline.

- [ ] **Step 3: Change the request body**

Update `src/media/cloudflare-vision-provider.ts` to send:

```text
Describe the image in detail, including:
- visible text
- what is happening
- likely context if obvious
```

Implementation notes:
- keep `temperature: 0`
- keep the same model and timeout handling
- stop requiring the response to normalize into the current strict `VisionArtifact` shape for the image-read path
- preserve the raw provider response text verbatim

- [ ] **Step 4: Keep the provider return shape explicit**

Return enough data from `CloudflareVisionProvider.describe(...)` to support:
- `rawResponse`
- raw text response extracted from `result.response`
- provider/model metadata

- [ ] **Step 5: Re-run the provider tests**

Run: `npm test -- tests/app.test.ts`
Expected: PASS after adapting the mocks and expectations.

## Task 3: Store image `vision_raw` and `vision_interpretation`

**Files:**
- Modify: `src/storage/database.ts`
- Modify: `src/app/chat-orchestrator.ts`
- Test: `tests/storage-database.test.ts`
- Test: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Write the failing storage tests**

Add tests in `tests/storage-database.test.ts` that:
- save a `vision_raw` artifact and retrieve it through `getSuccessfulMediaArtifact(...)`
- save a `vision_interpretation` artifact and retrieve it through `getSuccessfulMediaArtifact(...)`

- [ ] **Step 2: Run storage tests to verify current behavior**

Run: `npm test -- tests/storage-database.test.ts`
Expected: FAIL only after the new expectations are added, because the orchestrator does not yet write the new artifact kinds.

- [ ] **Step 3: Add image interpretation orchestration**

In `src/app/chat-orchestrator.ts`, split image processing into:
- Cloudflare call -> save `vision_raw`
- DeepSeek interpretation using `vision_raw + caption`
- save `vision_interpretation`

Rules:
- if `vision_interpretation` already exists, reuse it and do not re-run Cloudflare or DeepSeek
- if only `vision_raw` exists, reuse it and only run the interpretation step
- keep caption attached to both saved artifacts

- [ ] **Step 4: Preserve existing audio/video flow**

Do not redesign audio/video storage in this task.
Keep the current transcript provider artifacts working for:
- `voice`
- `audio`
- `video_note`

- [ ] **Step 5: Re-run orchestration and storage tests**

Run: `npm test -- tests/storage-database.test.ts tests/chat-orchestrator.test.ts`
Expected: PASS with new image caching behavior covered.

## Task 4: Make `read` answer from interpreted image context while still exposing raw vision text

**Files:**
- Modify: `src/llm/prompts.ts`
- Modify: `llm/reply/read.md`
- Modify: `src/app/chat-orchestrator.ts`
- Test: `tests/llm-prompts.test.ts`
- Test: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Write the failing prompt-shape test**

Add a test in `tests/llm-prompts.test.ts` that builds a `read` prompt with:
- image caption
- `vision_raw`
- `vision_interpretation`

and asserts the prompt contains both the interpreted layer and the raw layer.

- [ ] **Step 2: Run prompt tests to verify failure**

Run: `npm test -- tests/llm-prompts.test.ts`
Expected: FAIL because `DescribeMediaContext` does not yet contain image raw + interpreted fields.

- [ ] **Step 3: Extend the media prompt payload**

Update `src/llm/prompts.ts` so image media context contains:
- `sourceCaption`
- `visionRaw`
- `visionInterpretation`

Keep audio payloads intact.

- [ ] **Step 4: Update the `read` prompt**

Adjust `llm/reply/read.md` so image reads:
- rely mainly on `vision_interpretation`
- can use `vision_raw` as extra grounding
- keep visible text and caption available
- do not fall back to the old strict JSON-style image reasoning

- [ ] **Step 5: Re-run prompt and orchestrator tests**

Run: `npm test -- tests/llm-prompts.test.ts tests/chat-orchestrator.test.ts`
Expected: PASS for image `read` prompt composition and cached-image orchestration.

## Task 5: Make `explain` and `answer` media-aware for target messages

**Files:**
- Modify: `src/llm/prompts.ts`
- Modify: `llm/system/explain.md`
- Modify: `src/app/chat-orchestrator.ts`
- Test: `tests/llm-prompts.test.ts`
- Test: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Add tests that build `answer` and `explain` prompts where the reply target contains:
- target media
- target caption
- existing media analysis

Assert that the prompt includes those target-media blocks.

- [ ] **Step 2: Run prompt tests to verify failure**

Run: `npm test -- tests/llm-prompts.test.ts`
Expected: FAIL because `systemExplain` currently receives only text target + transcript.

- [ ] **Step 3: Enrich target media before generation**

In `src/app/chat-orchestrator.ts`:
- detect when the target reply message contains media
- ensure its media analysis exists before `explain` or `answer`
- pass target media context into `generateReply(...)`

Image rule:
- ensure `vision_interpretation`
- include `vision_raw`
- include caption

Audio/video rule:
- reuse existing transcript artifacts
- include caption when present

- [ ] **Step 4: Update the explain/answer system template**

Extend `llm/system/explain.md` with blocks for:
- `TARGET_MEDIA_CAPTION`
- `TARGET_MEDIA_RAW`
- `TARGET_MEDIA_INTERPRETATION`

Keep the existing text target and nearby chat transcript blocks.

- [ ] **Step 5: Re-run prompt and orchestrator tests**

Run: `npm test -- tests/llm-prompts.test.ts tests/chat-orchestrator.test.ts`
Expected: PASS for media-aware target handling in both `explain` and `answer`.

## Task 6: Add nearby-media scan for `explain`, `decide`, and `answer`

**Files:**
- Modify: `src/app/chat-orchestrator.ts`
- Modify: `src/storage/database.ts`
- Modify: `src/llm/prompts.ts`
- Modify: `llm/reply/answer.md`
- Test: `tests/chat-orchestrator.test.ts`
- Test: `tests/storage-database.test.ts`
- Test: `tests/llm-prompts.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Add orchestration tests covering:
- one already-processed media message inside the last 10 messages gets included in context
- one newest unprocessed media message inside the last 10 messages gets processed
- older unprocessed media messages inside the same 10-message window are not processed
- `answer` uses nearby chat context with the new prompt wording

- [ ] **Step 2: Run the failing tests**

Run: `npm test -- tests/chat-orchestrator.test.ts tests/llm-prompts.test.ts`
Expected: FAIL because nearby media scan does not exist yet.

- [ ] **Step 3: Add a nearby-media lookup helper**

In `src/storage/database.ts`, add a helper that can fetch successful media artifacts for known message IDs in reverse recency order.

Keep it simple:
- input is `chatId + messageIds[]`
- output is the cached artifacts already available for those messages

- [ ] **Step 4: Add a hardcoded 10-message media scan**

In `src/app/chat-orchestrator.ts`:
- inspect the 10 messages before `triggerMessageId`
- gather already-processed media from that window
- include those in prompt context
- if the newest relevant media in that window has no analysis yet, process only that one

Do not:
- process more than one missing media from the window
- scan beyond 10 messages
- turn this into long-term dialog memory

- [ ] **Step 5: Update answer prompt wording**

In `llm/reply/answer.md`, replace the current weak framing with explicit guidance:
- the target message may continue the nearby chat
- use nearby context to disambiguate references, jokes, follow-ups, and elliptic replies
- still answer the target message directly instead of summarizing the whole discussion

- [ ] **Step 6: Re-run the focused tests**

Run: `npm test -- tests/storage-database.test.ts tests/chat-orchestrator.test.ts tests/llm-prompts.test.ts`
Expected: PASS for nearby-media reuse and the new `answer` context behavior.

## Task 7: Full regression pass

**Files:**
- Test only

- [ ] **Step 1: Run the full targeted suite**

Run:

```bash
npm test -- \
  tests/env.test.ts \
  tests/storage-database.test.ts \
  tests/chat-orchestrator.test.ts \
  tests/llm-prompts.test.ts \
  tests/app.test.ts
```

Expected: PASS

- [ ] **Step 2: Smoke-check the prompt experiment artifact**

Confirm that `data/cloudflare-vision-empty-prompt-results.md` still reflects the approved minimal Cloudflare prompt experiment and keep it as an implementation reference unless the committed prompt text changes again.

- [ ] **Step 3: Review docs only if behavior changed beyond code comments**

If the implementation introduces user-visible behavior or env changes beyond `ANSWER_CONTEXT_LIMIT`, update:
- `docs/development.md`

Do not create extra docs unless the implementation reveals a durable behavior change that deserves documentation.

## Self-Review

- Spec coverage: covered `ANSWER_CONTEXT_LIMIT`, target media for `explain`/`answer`, image raw + interpretation caching, shared image context for `read`, nearby-media scan window of 10, cached-media reuse, and no political prompt changes.
- Placeholder scan: removed `TODO`-style gaps; every task names exact files, tests, and runtime behavior.
- Type consistency: plan uses `ANSWER_CONTEXT_LIMIT`, `vision_raw`, `vision_interpretation`, `visionRaw`, and `visionInterpretation` consistently.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-media-context-integration.md`.

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
