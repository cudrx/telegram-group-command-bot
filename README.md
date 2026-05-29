# Telegram Chat Assistant

A Telegram bot built with `Node.js`, `TypeScript`, `grammY`, and `SQLite`.

The bot is primarily command-driven. It stores a message log, can call an OpenAI-compatible LLM, optionally uses Tavily for web lookup, caches media recognition results, and can send voice replies through Yandex SpeechKit.

## Features

- Telegram update handling through `grammY` long polling.
- Access control: the main work chat is configured with `TELEGRAM_CHAT_ID`, private admin mode with `TELEGRAM_ADMIN_ID`, and link-only private users with `TELEGRAM_LINK_USER_IDS`.
- SQLite stores chats, messages, sender metadata, reply relationships, edit markers, media artifacts, sent meme history, and a small `app_state`.
- Commands: `/summarize`, `/decide`, `/answer`, `/translate`, `/read`, `/meme`, `/publish`.
- Lookup for `/decide` and `/answer` is enabled when `TAVILY_API_KEY` is set.
- Reply prompts receive the current Moscow date and time as plain text so the model can resolve "today", "tomorrow", and "yesterday".
- Automatic recognition for supported media when provider keys are present:
  `GLADIA_API_KEY`, `CLOUDFLARE_AI_API_KEY` + `CLOUDFLARE_ACCOUNT_ID`, `OCR_SPACE_API_KEY`.
- `/read` speaks the text of the replied-to message when `YANDEX_SPEECHKIT_API_KEY` is set.
- `/translate` translates into the target language the text, caption, OCR text, image description, or audio transcript from the replied-to message.
- `/meme` picks a random fresh post from Reddit top-week listings across a hardcoded subreddit pool, sends an image or video with the original title without replying to the command, and stores Telegram media metadata for future context. Reddit NSFW/spoiler posts are sent with Telegram's spoiler flag.
- Supported Reddit image/gallery/video post links, Instagram Reel links, and YouTube Shorts links in regular messages are expanded automatically in the work chat, the admin private chat, and link-only private chats. The bot downloads media to temporary files, sends it without replying to the source message, then tries to delete the link message. Reddit captions use the title, `r/<subreddit>`, and linked upvotes; Reels/Shorts captions use `<source>: <nickname> · likes: <linked count>`. Reddit NSFW/spoiler media is sent with Telegram's spoiler flag.
- `/publish` in the admin private chat copies the replied-to message, or the latest message before the command, into the work chat without source-author attribution.
- Local usage hints and fallback messages are sent as text even when outbound voice is enabled.
- Safe Telegram HTML formatting for bot replies.
- Deduplicated production deploy announcements through SQLite.

Regular mentions of the bot and regular private-chat text do not trigger the LLM. The exception is an explicit supported Reddit post, Instagram Reel, or YouTube Shorts link, which is handled locally without the LLM. Link-only users from `TELEGRAM_LINK_USER_IDS` can send supported links in private chat; their commands are ignored.
When a user edits an already stored incoming message, the bot updates its text and `edited_at` in SQLite for future context, but existing bot replies are not recalculated.

## Commands

- `/summarize` - summarize recent human messages in the chat.
- `/decide` - judge the current dispute; with lookup configured, it can verify external facts through Tavily.
- `/answer` - answer the replied-to message or the latest message before the command.
- `/translate` - translate the content of the replied-to message into the target language.
- `/read` - speak a replied-to text message; text after the command is ignored.
- `/meme` - send a random image/gallery/video meme that was not repeated in the last 14 days.
- `/publish` - in the admin private chat, copy the replied-to message or the latest message before the command into the work chat; albums are copied as a group when every album item was stored by the bot.

## Requirements

- Node.js `22` LTS
- npm `11+`
- Telegram bot token
- OpenAI-compatible LLM API key

Optional provider keys are needed only for the matching features.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env`:

```bash
cp .env.example .env
```

Replace the required placeholders:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_ADMIN_ID`
- `TELEGRAM_LINK_USER_IDS`
- `LLM_API_KEY`

Optional provider keys in `.env.example` are placeholders too. Replace the key when you need the provider, or remove/comment out that line. Environment validation rejects `your-*` placeholder values.

3. Change the LLM provider or model if needed:

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_REPLY_MODEL=deepseek-v4-flash
LLM_PLANNER_MODEL=deepseek-v4-flash
```

4. Create or update the SQLite schema:

```bash
npm run migrate
```

5. Start development mode:

```bash
npm run dev
```

## Main Environment Variables

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_ADMIN_ID`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_REPLY_MODEL`
- `LLM_PLANNER_MODEL`
- `TAVILY_API_KEY`
- `GLADIA_API_KEY`
- `OCR_SPACE_API_KEY`
- `CLOUDFLARE_AI_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `YANDEX_SPEECHKIT_API_KEY`
- `LOG_LEVEL`
- `LOG_COLOR`
- `LOG_LLM_TEXT`
- `SQLITE_PATH`
- `REDDIT_COOKIES_PATH`
- `INSTAGRAM_COOKIES_PATH`
- `YOUTUBE_COOKIES_PATH`

Runtime settings are split into two layers: deploy-specific values and secrets live in `src/config/env/`, while non-secret behavior and provider defaults live in `src/config/runtime/`. Only values added to the env schema can be overridden through the environment.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Additional eval commands:

```bash
npm run eval:intents
npm run eval:intents -- --id=decide-laptop-value-dispute
npm run eval:intents -- --intent=summarize
```

Eval reports are written to a local working directory.

## Structure

- `src/index.ts` - process entry point.
- `src/app.ts` - application assembly.
- `src/app/` - orchestration, Telegram message sending, HTML formatting, deploy announcements.
- `src/app/actions/` - modular action commands, command registry, and action-local helpers.
- `src/app/chat-orchestrator/` - incoming message lifecycle, persistence, media auto-read, and action dispatch through the registry.
- `src/config/env/` - environment schema, defaults, and validation.
- `src/database/` - SQLite schema, migrations, row mapping, and queries.
- `src/domain/` - shared domain types for messages, chats, and intents.
- `src/llm/` - prompt assembly, lookup planner, OpenAI-compatible client.
- `src/locales/locale.ts` - active user-facing text and language-specific patterns.
- `src/media/` - Telegram media download, Gladia, Cloudflare Vision, OCR.space.
- `src/tts/` - speech cleanup, voice policy, Yandex SpeechKit.
- `src/transport/` - Telegram message normalization.
- `llm/` - static prompt files.
- `scripts/` - migrations, deploy metadata, and eval scripts.
- `docs/` - documentation map, architecture, development guide.

## Docker

The root `compose.yml` is used for a local smoke check:

```bash
npm run build
docker compose config
docker compose up -d
docker compose ps
docker compose logs bot --tail=100 -f
docker compose down
```

Production deploys are built in GitHub Actions, published to GHCR, and applied on the server with `docker compose pull` + `docker compose up -d`. SQLite lives in mounted persistent storage rather than inside the container.

For Reddit video, Instagram Reels, and YouTube Shorts, a standalone `yt-dlp` zipapp is mounted into the container as `/usr/local/bin/yt-dlp`. The runtime image includes `python3`, `ffmpeg`/`ffprobe`, and Node.js 22 so `yt-dlp` can merge video/audio tracks into MP4 with audio, solve YouTube EJS challenges through `--js-runtimes node`, and then normalize video for Telegram. Reddit-hosted video, Instagram Reels, and YouTube Shorts all use the same pipeline: `yt-dlp metadata -> duration cap -> yt-dlp download -> ffprobe -> ffmpeg normalize -> sendVideo`. Videos longer than 120 seconds are not downloaded or converted, and downloaded files are checked again with `ffprobe`. Normalization runs one process at a time through `nice -n 19 ffmpeg -preset veryfast`, produces H.264/AAC MP4, `yuv420p`, `SAR 1:1`, `color_range tv`, removes metadata, and moves the moov atom to the beginning. YouTube Shorts use H.264 MP4 at `height<=854` to avoid oversized 720p/1080p variants for long Shorts. Reddit `fallback_url` and similar direct MP4 URLs are used only as metadata/video-post signals, not as download paths. `/meme` Reddit listings and direct Reddit links use `REDDIT_COOKIES_PATH`, Reels use `INSTAGRAM_COOKIES_PATH`, Shorts use `YOUTUBE_COOKIES_PATH`; when paths are not set, defaults are resolved next to SQLite.

## Documentation

- `docs/README.md` - Markdown file map.
- `docs/architecture.md` - architecture, invariants, and main flows.
- `docs/development.md` - local development, checks, CI/CD, and production notes.

## License

This project is licensed under the MIT License. See `LICENSE`.
