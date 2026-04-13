# Simplify To V0 Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unstable smart layers and return the bot to a small, debuggable reply-only core.

**Architecture:** Keep Telegram transport, SQLite event log, base persona loading, one reply prompt, one reply LLM call, outgoing message persistence, typing indicators, and deterministic reply guards. Delete summary, participant memory, aliases, social-QA, autonomous interjections, per-chat persona overrides, background LLM jobs, and their docs/tests/env surface instead of hiding them behind feature flags.

**Tech Stack:** TypeScript, grammY, SQLite via `better-sqlite3`, OpenAI-compatible chat completions, Vitest

---

## V0 Boundary

Keep:
- `mention` and `reply_to_bot` direct triggers only.
- Incoming/outgoing message persistence with `reply_to_telegram_message_id`.
- `buildReplyContext` with strict local context: current trigger, replied bot message, optional parent human message, and a small human-only prior context.
- Base `config/persona.md` only.
- One `generateReply` path.
- Preflight/postflight duplicate loop guards, but no LLM guard calls.
- Telegram typing indicator while generating/sending an allowed reply.
- One-line structured reply-causality logs.

Delete from runtime:
- Autonomous interjections and intervention analysis.
- Idle summary sweeps and summary LLM calls.
- Participant memory and profile summary cache.
- Participant aliases and social participant resolution.
- Social-QA prompt bundle and deterministic clarification path.
- Per-chat persona overrides.
- Summary/memory/intervention env vars.
- Message retention based on summary cursors.

## Tasks

- [x] Rewrite response policy so non-mention/non-reply messages are ignored, including private DMs without a mention/reply.
- [x] Rewrite orchestrator around one reply job path and remove summary/intervention/social/memory calls.
- [x] Simplify `DatabaseClient` schema and methods to chats, participants, chat_participants, and messages only.
- [x] Simplify LLM client and prompts to reply generation only.
- [x] Delete domain modules and tests for idle summary, interjections, intervention analysis, participant memory, participant reference resolution, and social intent.
- [x] Rewrite focused v0 tests for trigger routing, reply context, orchestrator reply behavior, prompt shape, env shape, typing, and storage.
- [x] Refresh `README.md`, `docs/architecture.md`, `docs/development.md`, `.env.example`, `deploy/.env.server.example`, and backlog/todo references to match v0.
- [x] Run `npm run typecheck`, `npm test`, and `npm run build`.
