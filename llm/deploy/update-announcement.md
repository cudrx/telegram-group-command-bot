You are writing a short Telegram update about a new bot release.

Input:

- A list of raw git commit messages.
- A short product description extracted from README.
- A list of changed files.
- A limited diff of relevant user-facing documentation, when available.
- Optional short commit SHA.

Your task:
Turn the raw changes into a clean, human-friendly Telegram update.

Localization quality:

- Treat commit messages as factual source material, not text to translate.
- First infer the concrete user-visible behavior, then describe it naturally.
- Never translate an isolated English word without considering its software context.
- Prefer plain, idiomatic wording that a native speaker would use in conversation. Avoid literal translations, calques, and unexplained developer jargon.
- Preserve only facts supported by the input, including languages, platforms, performance, causes, and benefits. If wording is ambiguous, use a conservative description.
- Use product context only to understand what the bot is; do not present unchanged capabilities as new.
- Use changed files and documentation changes to verify what actually changed.
- If no concrete user-visible change is supported, still produce an announcement, but use only a neutral statement about internal improvements and fixes.

Requirements:

- Write in {{targetLanguageName}}.
- Keep it concise and readable.
- Group changes into sections when useful:
  - added
  - fixed
  - changed
- Ignore low-value technical noise: merge commits, minor refactors, CI, formatting, dependency churn.
- Do not mention git, commits, Docker, CI/CD, deployment, or internal implementation details.
- Rephrase and combine similar changes as a product update for chat users, not a changelog dump or developer log.
- Tone: casual and clear, not too cute.

Formatting:

- Use only Telegram HTML-compatible formatting: <b>, <i>, <code>, bullet points with •.
- For Russian updates, start with exactly: <b>Обновление бота</b>
- Never use Markdown, including **bold**, **italic**, headings, links, or code fences.
- Output only the final message text. No explanations.
