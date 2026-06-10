# Telegram Group Command Bot

A command-driven Telegram group bot built with TypeScript, grammY, SQLite, and OpenAI-compatible LLM providers.

The bot stores chat history, runs explicit command flows, can use web lookup and media recognition when provider keys are configured, expands supported social media links locally, and can send selected replies as voice through Yandex SpeechKit.

## What It Does

- Handles Telegram updates through `grammY` long polling.
- Restricts access to the configured work chat, admin private chat, and optional link-only private users.
- Stores chats, messages, replies, edits, media artifacts, sent meme history, and app state in SQLite.
- Supports `/summarize`, `/decide`, `/answer`, `/translate`, `/read`, `/transcribe`, `/meme`, `/sex`, and `/publish`.
- Expands supported Reddit post links, Instagram Reels, and YouTube Shorts without calling the LLM.
- Keeps user-facing local fallbacks as text even when outbound voice is enabled.

Regular mentions and ordinary private-chat text do not trigger the LLM. Message edits update future context but do not recalculate existing bot replies.

## Quick Start

Requirements:

- Node.js `22` LTS
- npm `11+`
- Telegram bot token
- OpenAI-compatible LLM API key

Run locally:

```bash
npm install
cp .env.example .env
npm run migrate
npm run dev
```

Replace the required placeholders in `.env` before starting. Optional provider keys in `.env.example` can be filled in for matching features or removed/commented out.

## Main Commands

- `/summarize` - summarize recent human messages in the chat.
- `/decide` - judge the current dispute; with lookup configured, it can verify external facts.
- `/answer` - answer the replied-to message or the latest message before the command.
- `/translate` - translate the replied-to message content into the target language.
- `/read` - speak a replied-to text message.
- `/transcribe` - transcribe a replied-to Telegram video.
- `/meme` - send a fresh Reddit image, gallery, or video meme.
- `/sex` - send fresh Reddit image, gallery, or video media from its own subreddit pool.
- `/publish` - in the admin private chat, copy a message into the work chat.

## Project Map

- `src/index.ts` - process entry point.
- `src/app.ts` - application assembly and lifecycle.
- `src/app/actions/` - command action modules and registry.
- `src/app/chat-orchestrator/` - incoming message lifecycle, persistence, media auto-read, direct media links, and action dispatch.
- `src/config/env/` - environment schema, defaults, and validation.
- `src/config/runtime/` - non-secret runtime defaults grouped by feature and provider.
- `src/database/` - SQLite schema, migrations, row mapping, and queries.
- `src/llm/` - prompt assembly, lookup planner, OpenAI-compatible client, and deploy announcement formatting.
- `src/media/` - Telegram media download, Gladia, Cloudflare Vision, OCR.space, and media normalization helpers.
- `src/tts/` - speech cleanup, outbound voice policy, and Yandex SpeechKit.
- `llm/` - static prompt files.
- `scripts/` - migrations, deploy metadata, and maintenance scripts.
- `docs/` - architecture and development documentation.

## Documentation

- `docs/README.md` - Markdown file map.
- `docs/architecture.md` - architecture, invariants, command contracts, and data model.
- `docs/development.md` - environment variables, local development, checks, Docker, CI/CD, production deploy, and smoke checks.

## License

This project is licensed under the MIT License. See `LICENSE`.
