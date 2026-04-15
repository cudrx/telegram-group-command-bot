# Agent Workflow Preferences

These instructions describe how Codex should work in this repository unless the user says otherwise.

## Branching

- Work with regular git branches.
- For large implementation, debugging, or review tasks, prefer creating a new regular git branch before editing.
- Do not create git worktrees by default.
- Use the current workspace unless the user explicitly asks for a separate worktree.

## Delegation

- For non-trivial implementation, debugging, or review tasks, Codex should create worker subagents.
- Prefer splitting independent subtasks across workers instead of doing all exploration and implementation sequentially in one agent.
- Keep worker scopes disjoint to avoid merge conflicts.
- If the task is small or tightly coupled, Codex may keep the work local.

## Commits

- Do not create commits by default.
- Wait for the user to explicitly ask for commits.
- When the user is ready, they will ask Codex to form commits and write commit messages.

## Documentation

- All planning documents, design docs, implementation plans, and task briefs must live in `docs/superpowers/plans/`.
- Do not create alternative planning directories such as `docs/superpowers/specs/`.
- Keep `docs/superpowers/plans/` to at most 5 plan files by removing the oldest implemented plans once their durable decisions are reflected in the main docs.
- Before adding a new Markdown document, follow the repository documentation structure described in `docs/README.md`.
- After implementing a plan, always review `README.md`, `docs/architecture.md`, and `docs/development.md`; update them when behavior, architecture, workflow, deployment, data repair, or documentation policy changed.
- For large implementation, debugging, or review tasks, also review `docs/backlog/ideas.md`, `docs/todo/`, and `docs/superpowers/plans/`; remove or update stale backlog ideas, todo notes, and implemented plan details once their durable decisions are reflected in the main docs.

## Communication

- If a workflow choice matters, prefer branches over worktrees unless the user explicitly overrides this preference.
- If workers are used, briefly state what each worker owns.
- If the intended action, architecture, data repair, or user preference is unclear, ask a clarifying question before proceeding.
- For bot behavior, prompt, context-building, memory, loop-guard, or reply-policy changes, Codex must not implement silently. First explain the proposed implementation in concrete terms, including affected files, runtime behavior changes, and how the change will be tested. Proceed only after explicit user approval.
