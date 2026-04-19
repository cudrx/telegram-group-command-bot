# Task Router

Use this file only to classify the request and choose any extra instruction files.
Always apply `agent/dev-rules.md`.

## Small Tasks

Small tasks can proceed after `AGENTS.md`, this router, and `agent/dev-rules.md`.

Examples:

- Small documentation edits
- Narrow bug fixes
- Single-file changes
- Mechanical cleanups with clear scope

## Large Tasks

A task is large when it has multiple phases, broad blast radius, uncertain design,
substantial debugging, or non-trivial review work.

For large tasks, use `agent/playbooks/large-task.md`.

## Documentation Tasks

Use `agent/modules/documentation.md` for:

- New Markdown files
- Planning documents
- Design docs
- Implementation plans
- Rollout plans
- Task briefs
- Documentation policy or structure changes

## Bot Behavior Tasks

Use `agent/modules/bot-behavior.md` before changes to:

- Assistant prompts
- Bot behavior
- Context-building
- Memory
- Loop guards
- Reply policy

These changes require explicit user approval before implementation.
