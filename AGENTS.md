# Agent Instructions

This file is the entrypoint for repository-specific agent behavior. It should stay short and point to the modular instruction files under `agent/`.

Start here:

- `agent/00-start-here.md` - global contract and getting started flow
- `agent/01-task-router.md` - how to route small, large, debugging, review, documentation, and bot-behavior tasks
- `agent/03-dev-rules.md` - global development rules for branches, commits, docs, and communication
- `agent/99-registry.md` - index of module instructions and task playbooks

Core contract:

- Follow these repository instructions unless the user explicitly overrides them.
- Prefer the current workspace and regular git branches; do not create worktrees unless the user asks.
- Do not create commits unless the user explicitly asks.
- Keep planning documents in `docs/superpowers/plans/`.
- Do not silently change bot behavior, prompts, context-building, memory, loop guards, or reply policy; explain the proposed change and wait for explicit user approval first.
- If the user says something that looks like a repository rule, or explicitly asks to add a rule, clarify parameters when needed and add it to the appropriate instruction file.
- Keep the user oriented: explain non-obvious project behavior and implementation choices at a developer level, using pseudocode when helpful, and ask before deciding ambiguous architecture, behavior, or corner-case trade-offs.
