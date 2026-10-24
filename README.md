# Telegram Group Command Bot

A Telegram group assistant with utility commands built with TypeScript, grammY, SQLite, and OpenAI-compatible LLM providers.

The bot stores chat history, answers explicit @mentions, runs utility commands, can use web lookup and media recognition when provider keys are configured, expands supported social media links locally, and can send selected replies as voice through Yandex SpeechKit.

## What It Does

- Handles Telegram updates through `grammY` long polling.
- Restricts access to configured chats from `TELEGRAM_CHAT_CONFIG_PATH`, the operator private chat, and optional link-only private users from `TELEGRAM_ACCESS_CONFIG_PATH`.
- Stores chats, messages, replies, edits, media artifacts, sent meme history, and app state in SQLite.
- Answers `@bot_username` requests: questions, explanations, summaries, and disputes.
- Supports `/translate`, `/read`, `/transcribe`, `/meme`, and `/sex`.
- Expands supported Reddit post links, Instagram Reels, and YouTube Shorts without calling the LLM.
- Expands supported Reddit, Instagram, YouTube, and TikTok links into Telegram-safe media.
- Sends videos from Reddit posts, including Streamable links.
- Queues heavy video jobs with bounded global and per-chat concurrency.
- Keeps user-facing local fallbacks as text even when outbound voice is enabled.

An explicit `@bot_username` mention starts the assistant in enabled groups or the operator private chat. A bare mention is supported; a reply supplies the target. Ordinary messages and replies without a mention do not trigger the assistant. Link-only private users cannot invoke it. Message edits update future context without triggering a reply.

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

Replace the required placeholders in `.env` before starting. Then edit `data/telegram-chat-config.json` and `data/telegram-access-config.json` with your real Telegram ids. In the chat config, `commands` controls which slash commands are enabled per chat, `features` controls non-command flows such as `assistant`, `direct_links`, and `deploy_announcements`, and `reddit_sources` holds the chat-specific subreddit lists for `/meme` and `/sex`. If `commands.meme` or `commands.sex` is enabled, the matching `reddit_sources` list must be present and non-empty. Optional provider keys in `config/examples/.env.example` can be filled in for matching features or removed/commented out.

For Reddit-based `/meme`, `/sex`, and direct Reddit link expansion, you can also
set `REDDIT_COOKIE_HEADER_PATH` to a file containing a full browser `Cookie`
header when a plain Netscape cookie file is not enough for subreddit listings.
If Reddit rejects that header with HTTP 401/403, the bot warns the admin to
refresh it.

Media features require external runtime tools mounted into Docker from
`data/bin`: official standalone Linux `yt-dlp` and `gallery-dl`, plus static
`ffmpeg` and `ffprobe`. `gallery-dl` resolves direct Instagram carousel posts,
including mixed photo/video carousels, and TikTok Photo Mode galleries. The production image contains the Node.js app and
minimal OS certificates.

## Assistant Requests

Mention the actual bot username, for example `@hrupa_bot что здесь значит «мамонты»?`, `@hrupa_bot подведи итог обсуждения`, or `@hrupa_bot кто прав в споре?`. Use a reply to point to a specific message, including a previous bot answer. A bare mention also works. When the subject is unclear, the bot asks one short question; continue with another mention, optionally replying to that question.

The assistant retrieves bounded conversation candidates and explicit reply chains, then resolves the relevant messages and answers in one LLM call. External verification adds up to two parallel searches and a second grounded LLM call. It does not perform additional history searches after the model decision. `/answer`, `/summarize`, and `/decide` are retired.

Enable `features.assistant` per chat. Older config files remain readable: if that flag is absent, it inherits whether any legacy `commands.answer`, `commands.summarize`, or `commands.decide` flag was enabled. Explicit `features.assistant` takes precedence.

To collect ordinary group messages for context, disable BotFather privacy mode or give the bot the necessary administrator access; the bot can only use messages Telegram delivers to it.

## Utility Commands

- `/translate` - translate the replied-to message content into the target language.
- `/read` - speak a replied-to text message.
- `/transcribe` - transcribe a replied-to Telegram video.
- `/meme` - send a fresh Reddit image, GIF animation, gallery, or video meme.
- `/sex` - send fresh Reddit image, GIF animation, gallery, or video media from its own subreddit pool.

## Project Map

- `src/index.ts` - process entry point.
- `src/app.ts` - application assembly and lifecycle.
- `src/app/actions/` - command action modules and registry.
- `src/app/chat-orchestrator/` - incoming message lifecycle, persistence, media auto-read, direct media links, and action dispatch.
- `src/config/env/` - environment schema, defaults, and validation.
- `src/config/runtime/` - non-secret runtime defaults grouped by feature and provider.
- `src/database/` - SQLite schema, migrations, row mapping, and queries.
- `src/llm/` - prompt assembly, assistant research routing, OpenAI-compatible client, and deploy announcement formatting.
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
