# Explicit Assistant Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset v0 to a minimal explicit Telegram chat assistant over a SQLite message event log.

**Architecture:** Keep Telegram long polling, SQLite storage, message event logging, mention-only invocation, one neutral assistant instruction file, one OpenAI-compatible reply path, typing indicator, and focused tests. Remove persona/character framing, `reply_to_bot` routing, participant tables/state, old planning docs, and all social-participant behavior; v1+ judge/arbiter features stay in backlog only.

**Tech Stack:** Node.js, TypeScript, grammY, SQLite via `better-sqlite3`, OpenAI-compatible chat completions, Vitest.

**Implementation Status:** Implemented on branch `explicit-assistant-reset`. Durable behavior is reflected in `README.md`, `docs/architecture.md`, `docs/development.md`, and backlog docs.

---

## Decisions Already Made

- v0 is an explicit chat assistant over the Telegram/SQLite message event log.
- v0 answers only when explicitly invoked by `@mention`.
- `reply_to_bot` is removed from v0 for now.
- `participants` and `chat_participants` are removed from v0 for now.
- Sender identity needed for a message should be stored directly on `messages`.
- The production SQLite database will be cleared after deploying the new branch, so this reset does not need data-preserving migrations.
- The product is no longer a character bot, social participant, friend simulator, or persona experiment.
- The implementation should not keep persona/character artifacts around as compatibility aliases.
- The default assistant instruction file is `config/assistant-instructions.md`.
- The environment variable is `ASSISTANT_INSTRUCTIONS_FILE`.
- Do not add a separate response-language setting in v0; keep the default language in assistant instructions.
- v1+ may add assistant/judge intents such as `explain`, `summarize`, `decide`, and `find`.
- Dispute tracking and objective dispute memory are postponed v1+ topics, not v0 implementation.
- Old planning docs from the persona era should be deleted, not annotated and kept.

## Non-Goals

- Do not implement dispute entities in v0.
- Do not add internet lookup in v0.
- Do not add media analysis in v0.
- Do not add participant memory in v0.
- Do not keep participant presence tables in v0.
- Do not add free-form personality profiling at any stage.
- Do not add autonomous interjections.
- Do not add reply-to-bot conversation behavior in v0.
- Do not add slash-command routing unless a later design explicitly chooses it.
- Do not preserve `PERSONA_FILE`, `loadPersona`, `persona`, or `character` names as runtime concepts.

## File Ownership For Workers

- Worker A owns config/env/loader naming: `src/config/*`, `config/*`, `.env.example`, `deploy/.env.server.example`, related env/config tests.
- Worker B owns mention-only routing and storage schema: `src/domain/*`, `src/storage/*`, `src/transport/*` only as needed, related routing/storage/context tests.
- Worker C owns LLM/app wiring: `src/llm/*`, `src/app.ts`, `src/app/chat-orchestrator.ts`, related prompt/client/orchestrator/app/logger tests.
- Worker D owns documentation/backlog: `README.md`, `docs/README.md`, `docs/architecture.md`, `docs/development.md`, `docs/backlog/*`, `docs/superpowers/plans/*`.
- Keep edits disjoint where possible. Everyone must assume other workers may be editing nearby files and must not revert unrelated changes.

## Task 1: Rename Config From Persona To Assistant Instructions

**Files:**
- Create: `config/assistant-instructions.md`
- Delete: `config/persona.md`
- Delete: `config/personas/.gitkeep` and remove `config/personas/` if empty
- Rename or replace: `src/config/persona.ts` -> `src/config/assistant-instructions.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `deploy/.env.server.example`
- Replace tests: `tests/config-persona.test.ts` -> `tests/config-assistant-instructions.test.ts`
- Modify: `tests/env.test.ts`

- [ ] Write tests for `loadAssistantInstructions`.
  - It loads a non-empty instructions file.
  - It rejects an empty instructions file with an `Assistant instructions file is empty` error.
  - It verifies `config/assistant-instructions.md` does not contain character/persona/social-participant markers.

- [ ] Update env tests.
  - Default `assistantInstructionsFile` is `config/assistant-instructions.md`.
  - `ASSISTANT_INSTRUCTIONS_FILE` overrides the default.
  - `PERSONA_FILE` is not accepted as a compatibility path.

- [ ] Implement the loader rename.
  - Export `loadAssistantInstructions(filePath: string): Promise<string>`.
  - Remove `loadPersona`.
  - Use neutral error text.

- [ ] Implement the env rename.
  - Replace schema key `PERSONA_FILE` with `ASSISTANT_INSTRUCTIONS_FILE`.
  - Replace parsed property `personaFile` with `assistantInstructionsFile`.
  - Keep existing LLM provider env behavior unchanged except for removing character defaults.
  - Replace legacy fallback model name `qwen-plus-character` with a neutral fallback if legacy QWEN variables are still supported.

- [ ] Replace `config/persona.md` with `config/assistant-instructions.md`.
  - The file should describe neutral assistant instructions.
  - It should say the assistant answers explicit requests.
  - It should prefer concise Russian answers by default.
  - It should avoid social profiling and invented long-term facts.
  - It should not define a name, vibe, character, friendship, mimicry, teasing style, or chat participant identity.

- [ ] Re-run focused tests.
  - `npm test -- tests/config-assistant-instructions.test.ts tests/env.test.ts`

## Task 2: Cut Runtime Routing To Mention-Only

**Files:**
- Modify: `src/domain/models.ts`
- Modify: `src/domain/response-policy.ts`
- Modify: `src/app/chat-orchestrator.ts`
- Modify: `src/app/reply-context-builder.ts` or delete it if it no longer has a useful boundary
- Modify: `tests/response-policy.test.ts`
- Modify: `tests/chat-orchestrator.test.ts`
- Modify: `tests/reply-context-builder.test.ts` or delete it if the builder is removed

- [ ] Update domain types.
  - Replace `ReplyReason = "mention" | "reply_to_bot"` with `ReplyReason = "mention"` or remove the union if a literal is simpler.
  - Remove reply-to-bot-specific model expectations from tests.

- [ ] Update response policy tests.
  - Mention with bot username returns `mention`.
  - Ordinary group/private messages return `none` / ignored.
  - Replies to bot messages without a mention are ignored.

- [ ] Update response policy implementation.
  - Detect direct mention only.
  - Do not treat `replyToUserId === botUserId` as a trigger.

- [ ] Simplify reply context.
  - Keep current mention message.
  - Keep recent prior human/user messages from the same chat if still useful.
  - Remove anchor bot message and parent human cause as required fields.
  - Remove causal reply-to-bot context behavior.

- [ ] Update orchestrator routing.
  - Store incoming message.
  - Reply only for `mention`.
  - Keep typing, LLM generation, outgoing message send, and outgoing message persistence.
  - Remove reply-to-bot cooldown behavior if it is no longer used.

- [ ] Re-run focused tests.
  - `npm test -- tests/response-policy.test.ts tests/chat-orchestrator.test.ts tests/reply-context-builder.test.ts`

## Task 3: Remove Participant Tables And State

**Files:**
- Modify: `src/storage/database.ts`
- Modify: `src/domain/models.ts`
- Modify: `src/transport/telegram/normalize-message.ts` only if model naming needs cleanup
- Modify: `tests/storage-database.test.ts`
- Modify: any tests that expect `participants` or `chat_participants`

- [ ] Update storage tests for the reduced schema.
  - `chats` still stores chat metadata and last message times.
  - `messages` stores incoming and outgoing message events.
  - `messages` stores sender metadata directly: user id, username, first name, last name, display name, and bot flag.
  - No test should expect `participants` or `chat_participants`.

- [ ] Update the schema.
  - Remove `participants`.
  - Remove `chat_participants`.
  - Keep `chats`.
  - Keep `messages`.
  - Add any sender columns to `messages` that were previously read through participant state.

- [ ] Simplify save paths.
  - `saveIncomingMessage` inserts chat and message rows only.
  - `saveBotMessage` inserts chat and message rows only.
  - Remove participant upsert helpers.
  - Remove participant presence updates.

- [ ] Remove obsolete migration compatibility code.
  - Because production DB will be cleared after deploy, the schema does not need to preserve or migrate old participant data.
  - Keep schema creation idempotent for a fresh database.

- [ ] Re-run focused tests.
  - `npm test -- tests/storage-database.test.ts`

## Task 4: Rename Runtime Interfaces And Remove Character System Prompt

**Files:**
- Modify: `src/app.ts`
- Modify: `src/app/chat-orchestrator.ts`
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Modify: `src/llm/prompts.ts`
- Modify: `tests/app.test.ts`
- Modify: `tests/chat-orchestrator.test.ts`
- Modify: `tests/llm-prompts.test.ts`
- Modify: `tests/openai-compatible-llm-client.test.ts`
- Modify: `tests/logger.test.ts`

- [ ] Update tests to use `assistantInstructions` naming.
  - Replace `persona` input fields with `assistantInstructions`.
  - Replace `loadPersona` mocks with `loadAssistantInstructions`.
  - Replace `env.personaFile` with `env.assistantInstructionsFile`.
  - Replace expectations mentioning `config/persona.md` with `config/assistant-instructions.md`.

- [ ] Update prompt tests for the new contract.
  - Prompt contains `Assistant instructions:` instead of `Global persona:`.
  - Prompt says context controls facts and assistant instructions control response behavior/style.
  - Prompt no longer says “Russian friend”, “in-character”, “living participant”, “light teasing”, or similar.
  - Prompt still preserves transcript hardening against role markers, fenced blocks, and chat-message prompt injection.
  - Prompt still includes the current mention message and recent chat context.
  - Prompt no longer includes `Message of yours being replied to:` or `Parent human cause:`.
  - Prompt still includes duplicate-recovery instructions only if duplicate guard remains in the mention-only path.

- [ ] Update the OpenAI-compatible client system message.
  - Replace the current character prompt with a neutral assistant system message.
  - Keep the same single reply request path.
  - Keep the existing timeout/retry/logging behavior.

- [ ] Update orchestrator wiring.
  - Inject `loadAssistantInstructions`.
  - Read `env.assistantInstructionsFile`.
  - Pass `assistantInstructions` to `generateReply`.
  - Preserve mention-only routing, context building, typing, send, and persistence.

- [ ] Update application service naming.
  - Replace `telegram-character-bot` with a neutral name such as `telegram-assistant-bot`.
  - Keep log event names stable unless they directly encode character/persona.
  - Update `tests/logger.test.ts` if it asserts the service name.

- [ ] Re-run focused tests.
  - `npm test -- tests/app.test.ts tests/chat-orchestrator.test.ts tests/llm-prompts.test.ts tests/openai-compatible-llm-client.test.ts tests/logger.test.ts`

## Task 5: Clean Loop Guards And Eval Fixtures For The Smaller V0

**Files:**
- Modify or delete: `src/domain/reply-loop-guard.ts`
- Modify or delete: `src/app/reply-context-sanitizer.ts`
- Modify or delete: `tests/reply-loop-guard.test.ts`
- Modify or delete: `tests/reply-context-sanitizer.test.ts`
- Modify or delete: `tests/reply-degradation-evals.test.ts`
- Modify: package scripts only if an eval script becomes obsolete

- [ ] Decide which guards still matter for mention-only v0.
  - Removed the old reply-chain guard/eval layer from v0.
  - Future mention-only prompt regression coverage should be designed separately.

- [ ] Update or delete guard tests.
  - If a guard remains, tests should use neutral assistant fixture text.
  - If a guard is removed, delete its tests and imports.

- [ ] Update or delete offline degradation evals.
  - If evals remain, they must use `assistantInstructions`.
  - Remove instructions such as “Ты Хрюпа” or “отвечай как живой участник”.
  - Keep only eval cases relevant to mention-only behavior.

- [ ] Re-run focused commands.
  - If guard/eval files are deleted, run `npm test` after deletion.

## Task 6: Refresh Product Documentation To Minimal Assistant-Core

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`
- Modify: `docs/backlog/ideas.md`
- Modify: `docs/backlog/big-features.md`
- Modify: `docs/backlog/small-fixes.md` if roadmap wording references the old product frame

- [ ] Rewrite README framing.
  - Title should describe a Telegram chat assistant, not a character bot.
  - “What exists” should list Telegram integration, SQLite event log, mention-only invocation, minimal context, and LLM reply path.
  - Replace `config/persona.md` references with `config/assistant-instructions.md`.
  - Replace `PERSONA_FILE` references with `ASSISTANT_INSTRUCTIONS_FILE`.
  - State that production DB can be recreated for this reset if deployment notes need it.

- [ ] Rewrite architecture framing.
  - V0 scope should be “minimal explicit assistant core over event log”.
  - Product invariants should say event log is source of truth and `@mention` gates replies.
  - Remove persona-specific invariants.
  - Remove reply-to-bot context contract.
  - Remove participant table descriptions.
  - Update database model to `chats` and `messages`.

- [ ] Rewrite development docs.
  - Update local setup steps for `config/assistant-instructions.md`.
  - Update env variable lists.
  - Update production notes to say old SQLite data does not need repair for this reset because the DB will be cleared.

- [ ] Rewrite docs README map.
  - Point at `config/assistant-instructions.md`.
  - Describe it as neutral assistant instructions.

- [ ] Update backlog.
  - State v0 is being stabilized as mention-only assistant core.
  - Keep v1+ assistant/judge direction as postponed.
  - Remove implication that participant memory, aliases, social-QA, or reply-chain conversation design are near-term defaults.

## Task 7: Record V1+ Assistant/Judge Backlog Without Implementing It

**Files:**
- Modify: `docs/backlog/ideas.md`
- Modify: `docs/backlog/big-features.md`
- Do not create `docs/todo/` for this pass; record the postponed topic in backlog docs.

- [ ] Add a postponed v1+ assistant/judge section.
  - Intent families: `explain`, `summarize`, `decide`, `find`.
  - Invocation remains explicit and natural-language based.
  - Routing should be intent-based when implemented later.

- [ ] Add a postponed dispute-tracking section.
  - Future entity: `dispute`.
  - Candidate fields: `id`, `chat_id`, `start_message_id`, `end_message_id`, `trigger_message_id`, `status`, `topic`, `kind`, `verdict`, `created_at`.
  - Future participant/outcome concepts may return only as part of dispute design, not as v0 participant memory.

- [ ] Add objective memory constraints.
  - Allowed future memory describes resolved events only.
  - Examples: user judged right, judged wrong, neutral, dispute factual/subjective/mixed, known participants in the resolved dispute.
  - Forbidden memory: free-form personality labels, toxicity labels, “usually wrong”, “likes arguing”, or social profiling.

- [ ] Explicitly mark all of this as v1+ backlog.
  - No schema changes for disputes in v0.
  - No runtime dispute state in v0.
  - No participant memory tables in v0.

## Task 8: Delete Obsolete Planning Docs

**Files:**
- Delete: `docs/superpowers/plans/2026-04-13-simplify-to-v0-core.md`
- Delete: `docs/superpowers/plans/2026-04-15-loop-sanitizer-evals.md`
- Delete: `docs/superpowers/plans/2026-04-15-manual-llm-degradation-evals.md`
- Keep: `docs/superpowers/plans/2026-04-17-explicit-assistant-reset.md`

- [ ] Delete old persona-era plans.
  - Do not add obsolete-framing notes.
  - Do not preserve old prompt/persona/eval plans as current context.

- [ ] Confirm only the current reset plan remains in `docs/superpowers/plans/`.
  - `ls docs/superpowers/plans`

## Task 9: Repo-Wide Artifact Sweep

**Files:**
- Search entire repository.
- Modify files where old framing is active documentation, code, tests, examples, or old plans.

- [ ] Run a persona/character artifact search.
  - `rg -n "persona|Persona|character|Character|персона|персонаж|личность|friend|друг|Хрюпа|живой участник|in-character|PERSONA_FILE|loadPersona|qwen-plus-character" .`

- [ ] Run a reply-to-bot artifact search.
  - `rg -n "reply_to_bot|replyToBot|reply-to-bot|reply to bot|anchorBot|anchorParent|causal reply" src tests docs README.md`

- [ ] Run a participant artifact search.
  - `rg -n "participants|chat_participants|participant memory|participant aliases|Participant" src tests docs README.md`

- [ ] Classify hits.
  - Active runtime/config/test/docs hits must be removed, renamed, or moved to clearly postponed v1+ backlog.
  - `participant` may appear only in v1+ dispute/backlog wording if it refers to future dispute participants.
  - Old plan files should not remain as artifact hits because they are deleted.

- [ ] Run an assistant-instructions search.
  - `rg -n "assistantInstructions|ASSISTANT_INSTRUCTIONS_FILE|assistant-instructions|loadAssistantInstructions" src tests config docs .env.example deploy/.env.server.example`

- [ ] Confirm naming is internally consistent.
  - Public env: `ASSISTANT_INSTRUCTIONS_FILE`.
  - App env property: `assistantInstructionsFile`.
  - Loader: `loadAssistantInstructions`.
  - LLM input: `assistantInstructions`.
  - Config file: `config/assistant-instructions.md`.

## Task 10: Full Verification

**Files:**
- No planned source edits.

- [ ] Run typecheck.
  - `npm run typecheck`

- [ ] Run the full test suite.
  - `npm test`

- [ ] Run build.
  - `npm run build`

- [ ] Run migration smoke on a fresh database.
  - `npm run migrate`
  - Expected: fresh schema contains the reduced v0 tables only.

- [ ] Confirm no runtime compatibility mismatch remains.
  - `.env.example` and `deploy/.env.server.example` use the same variable that `parseEnv` reads.
  - `README.md` setup instructions match the new config path.
  - Tests do not import `src/config/persona.js`.
  - Tests do not expect `reply_to_bot` to trigger a reply.
  - Tests do not expect `participants` or `chat_participants` tables.
