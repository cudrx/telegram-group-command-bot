# Telegram Group Command Bot

A command-driven Telegram group bot built with TypeScript, grammY, SQLite, and OpenAI-compatible LLM providers.

The bot stores chat history, runs explicit command flows, can use web lookup and media recognition when provider keys are configured, expands supported social media links locally, and can send selected replies as voice through Yandex SpeechKit.

## What It Does

- Handles Telegram updates through `grammY` long polling.
- Restricts access to configured chats from `TELEGRAM_CHAT_CONFIG_PATH`, the operator private chat, and optional link-only private users from `TELEGRAM_ACCESS_CONFIG_PATH`.
- Stores chats, messages, replies, edits, media artifacts, sent meme history, and app state in SQLite.
- Supports `/summarize`, `/decide`, `/answer`, `/translate`, `/read`, `/transcribe`, `/meme`, and `/sex`.
- Expands supported Reddit post links, Instagram Reels, and YouTube Shorts without calling the LLM.
- Queues heavy video jobs with bounded global and per-chat concurrency.
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
mkdir -p data
cp config/examples/.env.example .env
cp config/examples/telegram-chat-config.example.json data/telegram-chat-config.json
cp config/examples/telegram-access-config.example.json data/telegram-access-config.json
npm run migrate
npm run dev
```

Replace the required placeholders in `.env` before starting. Then edit `data/telegram-chat-config.json` and `data/telegram-access-config.json` with your real Telegram ids. In the chat config, `commands` controls which slash commands are enabled per chat, `features` controls non-command flows such as `direct_links` and `deploy_announcements`, and `reddit_sources` holds the chat-specific subreddit lists for `/meme` and `/sex`. If `commands.meme` or `commands.sex` is enabled, the matching `reddit_sources` list must be present and non-empty. Optional provider keys in `config/examples/.env.example` can be filled in for matching features or removed/commented out.

For Reddit-based `/meme`, `/sex`, and direct Reddit link expansion, you can also
set `REDDIT_COOKIE_HEADER_PATH` to a file containing a full browser `Cookie`
header when a plain Netscape cookie file is not enough for subreddit listings.

Video features require external runtime tools mounted into Docker from
`data/bin`: official standalone Linux `yt-dlp`, static `ffmpeg`, and static
`ffprobe`. The production image contains the Node.js app and minimal OS
certificates.

## Main Commands

- `/summarize` - summarize recent human messages in the chat.
- `/decide` - judge the current dispute; with lookup configured, it can verify external facts.
- `/answer` - answer the replied-to message or the latest message before the command, using one fast web lookup only when needed.
- `/translate` - translate the replied-to message content into the target language.
- `/read` - speak a replied-to text message.
- `/transcribe` - transcribe a replied-to Telegram video.
- `/meme` - send a fresh Reddit image, gallery, or video meme.
- `/sex` - send fresh Reddit image, gallery, or video media from its own subreddit pool.

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
