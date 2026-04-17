# Documentation Instructions

Use this file for documentation structure and planning-document rules.

## Planning Documents

- All planning documents, design docs, implementation plans, rollout plans, and task briefs must live in `docs/superpowers/plans/`.
- Do not create alternative planning directories such as `docs/superpowers/specs/`.
- Keep `docs/superpowers/plans/` to at most 5 plan files by removing the oldest implemented plans once their durable decisions are reflected in the main docs.

## Adding Markdown

- Before adding a new Markdown document, follow the repository documentation structure described in `docs/README.md`.
- If a new Markdown file does not clearly fit an existing bucket, update `docs/README.md` first and then add the document.
- Prefer extending an existing document over creating a near-duplicate one.

## After Implementing A Plan

- Always review `README.md`, `docs/architecture.md`, and `docs/development.md`.
- Update those files when behavior, architecture, workflow, deployment, data repair, or documentation policy changed.
- For large implementation, debugging, or review tasks, also review `docs/backlog/ideas.md`, `docs/todo/`, and `docs/superpowers/plans/`.
- Remove or update stale backlog ideas, todo notes, and implemented plan details once their durable decisions are reflected in the main docs.
