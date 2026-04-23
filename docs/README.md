# Documentation Structure

This file is the canonical map for Markdown files in this repository.

## Why `AGENTS.md` Is Uppercase And In The Root

- `AGENTS.md` stays in the repository root because it is a repo-wide instruction file for coding agents.
- The uppercase filename is intentional: tools and agents commonly look for `AGENTS.md` by that exact name.
- It is not general product documentation. It is process and workflow policy for Codex and similar agents.

## Markdown Layout

Use these locations consistently:

- [`/README.md`](/home/tom/Documents/Projects/test-chatbot/README.md)
  project overview and quick start
- [`/AGENTS.md`](/home/tom/Documents/Projects/test-chatbot/AGENTS.md)
  repository-wide agent instruction entrypoint and short global contract
- [`/agent/`](/home/tom/Documents/Projects/test-chatbot/agent)
  modular agent instructions: task routing, global development rules, module instructions, and playbooks
- [`/llm/assistant/base.md`](/home/tom/Documents/Projects/test-chatbot/llm/assistant/base.md)
  base assistant instructions
- [`/llm/`](/home/tom/Documents/Projects/test-chatbot/llm)
  static LLM prompt text grouped by usage purpose
- [`/docs/architecture.md`](/home/tom/Documents/Projects/test-chatbot/docs/architecture.md)
  architecture and system invariants
- [`/docs/development.md`](/home/tom/Documents/Projects/test-chatbot/docs/development.md)
  local development workflow
- [`/docs/backlog/ideas.md`](/home/tom/Documents/Projects/test-chatbot/docs/backlog/ideas.md)
  backlog index and current backlog policy
- [`/docs/backlog/big-features.md`](/home/tom/Documents/Projects/test-chatbot/docs/backlog/big-features.md)
  крупные post-v0 подсистемы и замороженный “жирный” функционал
- [`/docs/backlog/small-fixes.md`](/home/tom/Documents/Projects/test-chatbot/docs/backlog/small-fixes.md)
  мелкие фиксы, простые фичи и эксплуатационные улучшения
- [`/docs/superpowers/plans/`](/home/tom/Documents/Projects/test-chatbot/docs/superpowers/plans)
  rolling window for recent planning documents: design docs, TЗ, implementation plans, rollout plans; current active roadmap is media intake, while internet-backed `/decide`/`/answer` lookup is implemented

## Rules

- Do not create `docs/superpowers/specs/`.
- Do not scatter planning Markdown across ad hoc directories.
- Keep no more than 5 files in `docs/superpowers/plans/`; remove the oldest implemented plans when adding new ones.
- If a new `.md` file does not clearly fit an existing bucket, update this file first and then add the document.
- Prefer extending an existing document over creating a near-duplicate one.
