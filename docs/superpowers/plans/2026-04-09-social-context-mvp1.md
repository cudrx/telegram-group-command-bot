# Social Context MVP-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic participant name resolution, human-first labels, and a social-QA reply hook without yet implementing social signals or relationship edges.

**Architecture:** Extend participant ingestion and storage with chat-scoped aliases plus `last_name`, add dedicated domain modules for social intent and participant reference resolution, then enrich reply orchestration and prompts with resolved participant context. Keep ambiguity handling deterministic in the orchestrator so the LLM only sees already-resolved people.

**Tech Stack:** TypeScript, Vitest, SQLite via `better-sqlite3`

---

### Task 1: Participant Identity Storage

**Files:**
- Modify: `src/domain/models.ts`
- Modify: `src/transport/telegram/normalize-message.ts`
- Modify: `src/storage/database.ts`
- Test: `tests/storage-database.test.ts`

- [ ] Add failing tests for `last_name`, human-first labels, alias persistence, and chat-scoped alias lookup.
- [ ] Run targeted tests and confirm the new assertions fail for the expected missing schema/behavior.
- [ ] Implement `fromLastName`, canonical display label formatting, `participants.last_name`, `participant_aliases`, and alias upsert/lookup helpers.
- [ ] Re-run the targeted storage tests and confirm they pass.

### Task 2: Resolver And Intent Domain

**Files:**
- Modify: `src/domain/models.ts`
- Create: `src/domain/participant-reference-resolution.ts`
- Create: `src/domain/social-intent.ts`
- Create: `tests/domain/participant-reference-resolution.test.ts`
- Create: `tests/domain/social-intent.test.ts`

- [ ] Add failing tests for alias normalization, candidate extraction, unique resolution, ambiguity, and social-QA heuristics.
- [ ] Run the new domain tests and confirm they fail because the modules do not exist yet.
- [ ] Implement the resolver and intent modules with typed results and exact-match chat-scoped semantics.
- [ ] Re-run the domain tests and confirm they pass.

### Task 3: Reply Flow Integration

**Files:**
- Modify: `src/app/chat-orchestrator.ts`
- Modify: `src/llm/prompts.ts`
- Modify: `tests/chat-orchestrator.test.ts`
- Modify: `tests/llm-prompts.test.ts`

- [ ] Add failing tests for clarification replies, resolved participant bundles, and social prompt sections.
- [ ] Run the targeted orchestrator/prompt tests and confirm they fail for the missing integration.
- [ ] Implement social intent detection, participant resolution, deterministic clarification replies, and enriched reply prompt input.
- [ ] Re-run the targeted tests and confirm they pass.

### Task 4: Final Verification

**Files:**
- Verify only

- [ ] Run `npm test` in the worktree and confirm the full suite passes.
- [ ] Run `npm run typecheck` in the worktree and confirm the project typechecks.
- [ ] Review the diff for scope drift and confirm it stays within MVP-1.
