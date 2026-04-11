# Agent Workflow Preferences

These instructions describe how Codex should work in this repository unless the user says otherwise.

## Branching

- Work with regular git branches.
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
- Before adding a new Markdown document, follow the repository documentation structure described in `docs/README.md`.

## Communication

- If a workflow choice matters, prefer branches over worktrees unless the user explicitly overrides this preference.
- If workers are used, briefly state what each worker owns.
- If the intended action, architecture, data repair, or user preference is unclear, ask a clarifying question before proceeding.
