# Large Task Playbook

Use this playbook for large implementation, debugging, or review tasks.

## Start

- Apply `agent/03-dev-rules.md` before editing.
- Review the relevant module instructions in `agent/99-registry.md`.

## Split Work

- Prefer worker subagents when worker usage is available and allowed.
- Split independent subtasks across workers instead of doing all exploration and implementation sequentially in one agent.
- Keep worker scopes disjoint to avoid merge conflicts.
- If the task is small or tightly coupled after inspection, keep the work local.

## Documentation Hygiene

- For large implementation, debugging, or review tasks, review `docs/backlog/ideas.md`, `docs/todo/`, and `docs/superpowers/plans/`.
- Remove or update stale backlog ideas, todo notes, and implemented plan details once durable decisions are reflected in the main docs.

## Finish

- Follow the commit rules in `agent/03-dev-rules.md`.
- If the final changes naturally fit in a single commit, include a ready-to-use commit message in the final response.
