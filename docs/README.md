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
  repository-wide agent workflow rules
- [`/config/persona.md`](/home/tom/Documents/Projects/test-chatbot/config/persona.md)
  base bot persona
- [`/docs/architecture.md`](/home/tom/Documents/Projects/test-chatbot/docs/architecture.md)
  architecture and system invariants
- [`/docs/development.md`](/home/tom/Documents/Projects/test-chatbot/docs/development.md)
  local development workflow
- [`/docs/backlog/ideas.md`](/home/tom/Documents/Projects/test-chatbot/docs/backlog/ideas.md)
  backlog, notes, and rough ideas
- [`/docs/superpowers/plans/`](/home/tom/Documents/Projects/test-chatbot/docs/superpowers/plans)
  all planning documents: design docs, TЗ, implementation plans, rollout plans

## Rules

- Do not create `docs/superpowers/specs/`.
- Do not scatter planning Markdown across ad hoc directories.
- If a new `.md` file does not clearly fit an existing bucket, update this file first and then add the document.
- Prefer extending an existing document over creating a near-duplicate one.
