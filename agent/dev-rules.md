# Development Rules

These global workflow rules apply across tasks unless the user explicitly says
otherwise.

## Branches And Worktrees

- Use the current workspace by default.
- Work with regular git branches when a separate branch is useful.
- Do not create git worktrees unless the user asks.

## Commits

- Do not create commits by default.
- Wait for the user to explicitly ask for commits.
- When final changes naturally fit in a single commit, include a ready-to-use
  commit message in the final response.

## Collaboration

- Ask before deciding ambiguous architecture, behavior, data repair, or
  corner-case trade-offs.
- If the user states or asks to add a repository rule, clarify missing
  parameters when needed and add it to the appropriate instruction file.
- Keep the user oriented about non-obvious project behavior and implementation
  choices at a developer level, using pseudocode when helpful.

## Evals

- Keep eval fixtures and expectations current with behavior changes, prompt
  changes, context-building changes, and new assistant modes.
- For new intent-based modes, add focused eval coverage alongside the
  implementation so behavior can be tracked over time.
