# Large Task Playbook

Use this playbook for large implementation, debugging, or review tasks.

## Split Work

- Prefer worker subagents when worker usage is available, allowed, and useful.
- Split independent subtasks across workers instead of doing all exploration and
  implementation sequentially in one agent.
- Keep worker scopes disjoint to avoid merge conflicts.

## Documentation Hygiene

- Apply the large-task documentation checks in
  `agent/modules/documentation.md`.

## Finish

- Verify the work with the relevant tests or checks.
- Follow the commit rules in `agent/dev-rules.md`.
