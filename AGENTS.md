# Agent Instructions

`AGENTS.md` is the canonical entrypoint for Codex and similar coding agents in
this repository. Start here, then read only the instruction files needed for the
current task.

Core contract:

- Follow these repository instructions unless the user explicitly overrides them.
- Apply `agent/dev-rules.md` for global workflow rules.
- Use `agent/task-router.md` to classify the task and choose any extra module or
  playbook.
- Prefer the current workspace and regular git branches; do not create worktrees
  unless the user asks.
- Do not create commits unless the user explicitly asks.
- If files were changed or created during the task, include a ready-to-use
  commit message in the final response.
- Commit messages MUST follow the format: "<type>: <short description>".
- Keep planning documents in `docs/superpowers/plans/`.
- Do not silently change bot behavior, prompts, context-building, memory, loop
  guards, or reply policy; apply `agent/modules/bot-behavior.md` and wait for
  explicit user approval first.

Instruction map:

- `agent/task-router.md` - task classification only
- `agent/dev-rules.md` - global workflow rules
- `agent/modules/documentation.md` - documentation structure, planning documents,
  and doc hygiene
- `agent/modules/bot-behavior.md` - approval gate for bot behavior and prompt
  changes
- `agent/playbooks/large-task.md` - extended procedure for large tasks
