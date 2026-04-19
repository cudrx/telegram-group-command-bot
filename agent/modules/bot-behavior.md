# Bot Behavior Instructions

Use this file for changes that affect how the assistant or bot behaves. This is
the source of truth for the bot-behavior approval gate.

## Approval Gate

For bot behavior, prompt, context-building, memory, loop-guard, or reply-policy changes, Codex must not implement silently.

Before implementation:

- Explain the proposed implementation in concrete terms.
- List affected files.
- Describe runtime behavior changes.
- Describe how the change will be tested.
- Describe which eval fixtures or eval expectations will be added, updated, or deliberately left unchanged.
- Proceed only after explicit user approval.
