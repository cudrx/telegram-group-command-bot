# Task Router

Use this file to decide which instruction files apply to a request.

## Small Or Tightly Coupled Tasks

Keep the work local when the task is small, low-risk, or tightly coupled enough that splitting it would add overhead.

Examples:

- Small documentation edits
- Narrow bug fixes
- Single-file changes
- Mechanical cleanups with clear scope

## Large Implementation, Debugging, Or Review Tasks

For non-trivial implementation, debugging, or review tasks:

- Prefer creating a new regular git branch before editing.
- Prefer splitting independent subtasks across worker agents when worker usage is available and allowed.
- Keep worker scopes disjoint to avoid merge conflicts.
- Use `agent/playbooks/large-task.md`.

## Documentation Tasks

Use `agent/modules/documentation.md` for:

- New Markdown files
- Planning documents
- Design docs
- Implementation plans
- Rollout plans
- Task briefs
- Updates to documentation policy or structure

## Bot Behavior Tasks

Use `agent/modules/bot-behavior.md` for changes to:

- Assistant prompts
- Bot behavior
- Context-building
- Memory
- Loop guards
- Reply policy

These changes require explicit user approval before implementation.

## Global Rules

Always apply `agent/03-dev-rules.md`.
