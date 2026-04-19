# LLM Prompt Files Implementation Plan

**Status:** Implemented. Keep this plan only as recent implementation context; durable behavior is reflected in README, architecture, development docs, prompt tests, env tests, and deployment files.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move static LLM prompt text into a root `llm/` directory so prompts are easy to inspect, tweak, and share from one place.

**Architecture:** Keep TypeScript responsible for safe prompt assembly, mode selection, transcript formatting, lookup source formatting, and sanitization. Store stable human-written prompt text in markdown files under `llm/`; load those files synchronously at runtime from the project working directory. Do not add hot reload, build-time generation, or semantic prompt changes.

**Tech Stack:** Node.js, TypeScript ESM, Vitest, Markdown prompt assets, existing Docker/compose deployment.

---

### Task 1: Create Prompt Asset Contract

**Files:**
- Create: `llm/assistant/base.md`
- Create: `llm/reply/global.md`
- Create: `llm/reply/explain.md`
- Create: `llm/reply/summarize.md`
- Create: `llm/reply/decide.md`
- Create: `llm/reply/lookup-context.md`
- Create: `llm/planner/lookup.md`
- Create: `llm/deploy/update-announcement.md`
- Modify: `tests/config-assistant-instructions.test.ts`
- Modify: `tests/env.test.ts`
- Modify: `tests/llm-prompts.test.ts`
- Modify: `tests/lookup-planner.test.ts`
- Modify: `tests/deploy-update-prompt.test.ts`

- [x] **Step 1: Write failing tests**

Add assertions that the production assistant instructions are read from `llm/assistant/base.md`, env defaults point to that path, and assembled prompts contain text that is sourced from each markdown asset.

- [x] **Step 2: Run focused tests to verify failure**

Run:

```bash
npm test -- tests/config-assistant-instructions.test.ts tests/env.test.ts tests/llm-prompts.test.ts tests/lookup-planner.test.ts tests/deploy-update-prompt.test.ts
```

Expected: FAIL because `llm/` prompt files and loader behavior do not exist yet.

### Task 2: Move Static Prompt Text

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/llm/prompts.ts`
- Modify: `src/llm/lookup-planner.ts`
- Modify: `src/llm/deploy-update-prompt.ts`
- Delete: `config/assistant-instructions.md`

- [x] **Step 1: Move markdown text into `llm/`**

Move the current assistant instructions and prompt constants into the markdown files listed in Task 1 without changing their wording.

- [x] **Step 2: Load prompt markdown from TypeScript**

Add small local file-loading helpers where needed. Keep existing public prompt builder APIs synchronous unless tests show a real need to change them.

- [x] **Step 3: Run focused tests to verify green**

Run:

```bash
npm test -- tests/config-assistant-instructions.test.ts tests/env.test.ts tests/llm-prompts.test.ts tests/lookup-planner.test.ts tests/deploy-update-prompt.test.ts
```

Expected: PASS.

### Task 3: Update Deployment And Documentation

**Files:**
- Modify: `Dockerfile`
- Modify: `compose.yml`
- Modify: `README.md`
- Modify: `docs/development.md`
- Modify: `docs/architecture.md`
- Modify: `docs/README.md`
- Modify tests with old path references if any remain

- [x] **Step 1: Update deployment file inclusion**

Replace `config` copy/mount rules with `llm` copy/mount rules so prompt assets are present in local and image runtime.

- [x] **Step 2: Update docs and stale path references**

Replace references to `config/assistant-instructions.md` with `llm/assistant/base.md`, and document that `llm/` owns static prompt text while `src/llm/` owns prompt assembly and LLM calls.

- [x] **Step 3: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands PASS.
