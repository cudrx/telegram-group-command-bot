# Development Rules

These rules apply across all tasks unless the user explicitly says otherwise.

## Branching

- Work with regular git branches.
- For large implementation, debugging, or review tasks, prefer creating a new regular git branch before editing.
- Do not create git worktrees by default.
- Use the current workspace unless the user explicitly asks for a separate worktree.

## Delegation

- For non-trivial implementation, debugging, or review tasks, Codex should create worker subagents when worker usage is available and allowed.
- Prefer splitting independent subtasks across workers instead of doing all exploration and implementation sequentially in one agent.
- Keep worker scopes disjoint to avoid merge conflicts.
- If the task is small or tightly coupled, keep the work local.

## Commits

- Do not create commits by default.
- Wait for the user to explicitly ask for commits.
- When the user is ready, they will ask Codex to form commits and write commit messages.
- When the final changes are ready to push and naturally fit in a single commit, include a ready-to-use commit message in the final response without asking first; the user will decide whether to commit and push from the IDE.

## Tests And Evals

- Keep eval fixtures and eval expectations current with behavior changes, prompt changes, context-building changes, and new assistant modes.
- Treat eval maintenance like documentation maintenance: when behavior changes, review the relevant evals and update, add, or explicitly note why no eval update is needed.
- For new intent-based modes, add focused eval coverage alongside the implementation so factual behavior can be tracked over time.

## Communication

- If a workflow choice matters, prefer branches over worktrees unless the user explicitly overrides this preference.
- If workers are used, briefly state what each worker owns.
- If the intended action, architecture, data repair, or user preference is unclear, ask a clarifying question before proceeding.
- If the user says something that looks like a repository rule, or explicitly asks to add a rule, clarify the missing parameters when needed and add the rule to the appropriate file under `AGENTS.md` or `agent/`.
- Keep the user oriented about what is happening in the project and how it works. Assume the user understands JavaScript, architecture, and pseudocode; explain non-obvious behavior or trade-offs at that level when useful.
- When doubts, ambiguous requirements, architecture choices, behavior choices, or corner cases appear, ask the user instead of making a non-obvious decision on their behalf.
