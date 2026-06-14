# Development Guide

## Requirements

- Node.js `22` LTS
- npm `11+`
- Telegram bot token
- OpenAI-compatible LLM API key

## Main Files

- `README.md` - overview and quick start.
- `docs/README.md` - Markdown documentation structure.
- `docs/architecture.md` - architecture and flows.
- `docs/development.md` - this guide.
- `llm/assistant/base.md` - base assistant prompt.
- `llm/` - static prompt files.
- `src/app/actions/` - command action modules and command registry.
- `src/llm/current-datetime.ts` - current Moscow date/time formatting for reply prompts.
- `src/locales/locale.ts` - active user-facing text and language-specific patterns.
- `src/config/env/` - environment schema, defaults, and validation.
- `src/config/runtime/` - typed runtime defaults grouped by action and provider.
- `scripts/` - migrations, eval scripts, and deploy metadata.

## Environment

Required variables:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_CONFIG_PATH`
- `TELEGRAM_ACCESS_CONFIG_PATH`
- `LLM_API_KEY`

Access and storage:

- `TELEGRAM_CHAT_CONFIG_PATH` - primary path to a JSON file with chat policies.
- `TELEGRAM_ACCESS_CONFIG_PATH` - path to a JSON file with global operator access settings.
- `SQLITE_PATH`
- `REDDIT_COOKIE_HEADER_PATH` - optional path to a file containing a full browser `Cookie` header for Reddit listing/direct requests; when set, it overrides `REDDIT_COOKIES_PATH`.
- `REDDIT_COOKIES_PATH` - optional path to Netscape cookies for Reddit listing/direct video requests.
- `INSTAGRAM_COOKIES_PATH` - optional path to Netscape cookies for Instagram Reels.
- `YOUTUBE_COOKIES_PATH` - optional path to Netscape cookies for YouTube Shorts.

LLM:

- `LLM_BASE_URL`
- `LLM_REPLY_MODEL`
- `LLM_PLANNER_MODEL`
- `LLM_REPLY_TEMPERATURE`
- `LLM_TIMEOUT_MS`
- `LLM_MAX_RETRIES`

Behavior:

- `REPLY_MIN_TYPING_MS`
- `REPLY_MAX_TYPING_MS`
- `REPLY_TYPING_REFRESH_MS`

Lookup:

- `TAVILY_API_KEY` - lookup for `/decide` and `/answer`.
- `LOOKUP_TIMEOUT_MS`
- `LOOKUP_MAX_QUERIES`
- `LOOKUP_MAX_RESULTS`

Media and voice providers:

- `GLADIA_API_KEY` - audio/video-note transcription and `/transcribe`.
- `CLOUDFLARE_AI_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` - image description.
- `OCR_SPACE_API_KEY` - OCR.
- `YANDEX_SPEECHKIT_API_KEY` - outbound voice.

Logging and runtime:

- `NODE_ENV`
- `LOG_LEVEL`
- `LOG_COLOR`
- `LOG_LLM_TEXT`

`TELEGRAM_CHAT_CONFIG_PATH` should point to a JSON array of chat policies. Unknown feature names, duplicate chat ids, invalid JSON, and unreadable files all fail startup.

`TELEGRAM_ACCESS_CONFIG_PATH` should point to a JSON object with:

- `adminUserId` - required Telegram user id of the global operator.
- `adminDefaultChatId` - optional default operator chat used by `/publish` and deploy announcements.
- `linkUserIds` - optional array of Telegram user ids allowed to DM only supported direct media links.

`adminDefaultChatId` must refer to one of the configured chats from `TELEGRAM_CHAT_CONFIG_PATH`.

`config/examples/.env.example` contains placeholders. Environment validation rejects `your-*` values, so optional provider keys should either be replaced or removed/commented out.

Runtime settings that are not secrets and do not require deploy-specific overrides live in `src/config/runtime/`. Values are grouped by scenario (`actions/answer`, `actions/read`, `actions/meme`, `actions/sex`) and external provider (`providers/llm`, `providers/media`, `providers/tts`, `providers/lookup`). Settings that differ between environments go through `src/config/env/schema.ts`; defaults come from runtime config.

## Local Run

```bash
npm install
mkdir -p data
cp config/examples/.env.example .env
cp config/examples/telegram-chat-config.example.json data/telegram-chat-config.json
cp config/examples/telegram-access-config.example.json data/telegram-access-config.json
npm run migrate
npm run dev
```

Replace required values in `.env` before starting, then edit `data/telegram-chat-config.json` and `data/telegram-access-config.json` with your real Telegram ids and feature flags.

If you use a different OpenAI-compatible provider, change:

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_REPLY_MODEL=deepseek-v4-flash
LLM_PLANNER_MODEL=deepseek-v4-flash
```

For detailed debugging:

```dotenv
LOG_LEVEL=debug
LOG_LLM_TEXT=true
LOG_COLOR=true
```

`LOG_LLM_TEXT=true` writes a compact trace and short preview, but not the full prompt/response.

## NPM Scripts

- `npm run dev` - local run through `tsx watch`.
- `npm run migrate` - create or update the SQLite schema.
- `npm run lint` - `biome check`.
- `npm run lint:fix` - `biome check --write`.
- `npm run format` - `biome format --write`.
- `npm run typecheck` - `tsc --noEmit`.
- `npm test` - `vitest run`.
- `npm run build` - build the TypeScript project.
- `npm start` - run the built application.
- `npm run eval:intents` - full intent eval suite.
- `npm run eval:intents -- --id=<fixture-id>` - one fixture.
- `npm run eval:intents -- --intent=<intent>` - fixtures for one intent.

## Checks

For regular changes:

```bash
npm run lint
npm run typecheck
npm test
```

For runtime, build, or deploy changes:

```bash
npm run build
```

For intent routing or prompt-contract changes:

```bash
npm run eval:intents
```

The reply-model prompt contract includes a `CURRENT_DATETIME` block with current Moscow date and time in plain text. This helps the LLM resolve relative dates correctly.

## Local Docker

The root `compose.yml` starts a local container with bind mounts.

```bash
npm run build
docker compose config
docker compose up -d
docker compose ps
docker compose logs bot --tail=100 -f
docker compose down
```

SQLite is stored in mounted persistent storage.

If Docker returns `permission denied`, use `sudo` or add the user to the `docker` group and start a new session.

For Reddit video, Instagram Reels, and YouTube Shorts, runtime media tools are
mounted into the container from persistent storage. `data/bin/yt-dlp` must be
the official standalone Linux binary, and `data/bin/ffmpeg` plus
`data/bin/ffprobe` must be static binaries, such as the John Van Sickle static
builds. The Docker image includes Node.js 22 and OS certificate authorities, but
the media tools live in persistent storage. The compose files mount those tools
read-only into `/usr/local/bin` and put `/usr/local/bin` first on `PATH`.
Reddit-hosted video, Instagram Reels, and YouTube Shorts all use the same
pipeline: `yt-dlp metadata -> duration cap -> yt-dlp download -> ffprobe ->
ffmpeg normalize -> ffprobe -> sendVideo`.

Videos longer than 600 seconds are not downloaded or converted, and downloaded files are checked again with `ffprobe`. Direct video sends for Reddit, Instagram Reels, YouTube Shorts, `/meme`, and `/sex` use a 50 MB file cap because this project uses the standard Telegram Bot API rather than a local Bot API server. Normalization runs one process at a time through `nice -n 19 ffmpeg -preset veryfast`, produces H.264/AAC MP4, `yuv420p`, `SAR 1:1`, `color_range tv`, removes metadata, and moves the moov atom to the beginning. After normalization, the bot probes the output dimensions and passes `duration`, `width`, `height`, and `supports_streaming` to Telegram `sendVideo`. YouTube Shorts use H.264 MP4 at `height<=854` to avoid oversized 720p/1080p variants for long Shorts. Reddit `fallback_url` and similar direct MP4 URLs are used only as metadata/video-post signals, not as download paths.

## CI

CI workflow: `.github/workflows/ci.yml`.

On `push`, `pull_request`, and manual `workflow_dispatch`, it runs:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`

## Production Deploy

Deploy workflow: `.github/workflows/deploy.yml`.

Deploys run automatically on `push` to `main` and manually through GitHub Actions `Run workflow`. The workflow uploads compose/assets, publishes the Docker image to GHCR, and runs pull/up on the server through `deploy/remote-deploy.sh`.

GitHub Secrets:

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_KEY`
- `SERVER_GHCR_USERNAME`
- `SERVER_GHCR_TOKEN`

The server directory next to the deploy compose file should contain an environment file and persistent storage directory. Start from `config/examples/.env.example`, then add the deploy-only image coordinates below. The persistent storage must include the two JSON config files referenced below:

```text
data/telegram-chat-config.json
data/telegram-access-config.json
```

Minimum server values:

```dotenv
GHCR_IMAGE=ghcr.io/<github-owner>/telegram-group-command-bot
IMAGE_TAG=latest
```

`deploy/compose.yml` already forces `NODE_ENV=production` and
`SQLITE_PATH=/app/data/bot.sqlite`. The shared example env already points chat
and access config to `data/...`, which resolves inside the container through the
`./data:/app/data` bind mount.

Optional provider keys are added there as well.

The server persistent storage must also contain executable media tools:

```text
data/bin/yt-dlp
data/bin/ffmpeg
data/bin/ffprobe
```

Use the official standalone Linux `yt-dlp` binary. Use static `ffmpeg` and
`ffprobe` binaries; do not bind-mount host distribution binaries from another
Linux distribution into the Debian-based container, because their shared
libraries may be unavailable.

Deploy metadata is written to persistent storage; inside the container the bot reads it as `/app/data/deploy-metadata.json`. The announcement is sent once per new `sha` and deduplicated through SQLite `app_state`.

Rollback:

1. Set the old `IMAGE_TAG` in the server `.env`.
2. Run `docker compose --env-file .env -f compose.yml pull bot`.
3. Run `docker compose --env-file .env -f compose.yml up -d bot`.

## Manual Smoke Checks

- Use a separate test bot and test group for Telegram smoke checks.
- Start with explicit `/answer`, `/translate`, `/summarize`, `/decide`, `/read`, `/transcribe`.
- Check `/answer` both as a reply and without a reply: without a reply, it answers the latest message before the command.
- `/translate` and `/read` require a reply to the target message.
- `/transcribe` requires a reply to a Telegram video message. It should work on videos sent by users and videos sent by this bot, ignore command arguments and links, extract audio with `ffmpeg`, return the transcript as text, and avoid creating `media_artifacts` rows.
- `/translate` should return a local fallback for target-language content and translate other text/media blocks into the target language with source headings.
- Editing an already stored message should update future context without sending a new reply by itself.
- `/meme` and `/sex` make an external request to a Reddit top-month listing with auth from `REDDIT_COOKIE_HEADER_PATH` when present, otherwise from `REDDIT_COOKIES_PATH`. They select a fresh supported image/gallery/video post from their own subreddit pools, send media without replying to the command, download media to temporary files, and should clean them after successful dispatch and Telegram errors. Video posts require mounted standalone `yt-dlp` plus static `ffmpeg` and `ffprobe`. Reddit NSFW/spoiler posts are allowed and sent with Telegram's spoiler flag; for galleries, the spoiler flag should be set on every item.
- Direct Reddit media link smoke: make standalone `yt-dlp` plus static `ffmpeg` and `ffprobe` available inside the container through `/usr/local/bin`, configure `REDDIT_COOKIE_HEADER_PATH` or `REDDIT_COOKIES_PATH`, then send a Reddit post URL with image, gallery, or `reddit_video` in a configured chat with `direct_links: true`, the operator private chat, or a private chat with a user from `linkUserIds` in `telegram-access-config.json`. The bot should send `sendPhoto`, `sendMediaGroup`, or `sendVideo` without replying to the source message, include title/subreddit/upvotes, store post metadata, clean temporary files, and try to delete the source link message. Video sends should include the normalized file's `width`/`height`, `duration`, and `supports_streaming`. Reddit NSFW/spoiler media should be sent with Telegram's spoiler flag; for galleries, it should be set on every item. In groups, deleting the source message requires bot admin rights and disabled BotFather privacy mode when the link is sent without a command/mention.
- Direct Instagram Reels smoke: configure `INSTAGRAM_COOKIES_PATH`, then send `https://www.instagram.com/reel/<shortcode>/` in a configured chat with `direct_links: true`, the operator private chat, or a private chat with a user from `linkUserIds` in `telegram-access-config.json`. The bot should get metadata through `yt-dlp`, skip videos longer than 600 seconds, download the Reel through `yt-dlp`, verify MP4 with `ffprobe`, normalize with `nice -n 19 ffmpeg -preset veryfast`, probe the normalized dimensions, send `sendVideo` without a reply using `width`/`height`, `duration`, and `supports_streaming`, caption it as `inst: <nickname> · likes: <linked count>`, clean temporary files, and try to delete the source message. If the Reel is over 10 minutes or 50 MB, the bot should reply with a local limit-specific error instead of sending video.
- Direct YouTube Shorts smoke: configure `YOUTUBE_COOKIES_PATH`, then send `https://youtu.be/<id>`, `https://www.youtube.com/watch?v=<id>`, or `https://www.youtube.com/shorts/<id>` in a configured chat with `direct_links: true`, the operator private chat, or a private chat with a user from `linkUserIds` in `telegram-access-config.json`. The bot should get metadata through `yt-dlp`, skip videos longer than 600 seconds, download the Short as H.264 MP4 at `height<=854`, verify MP4 with `ffprobe`, normalize with `nice -n 19 ffmpeg -preset veryfast`, probe the normalized dimensions, send `sendVideo` without a reply using `width`/`height`, `duration`, and `supports_streaming`, caption it as `yt: <channel> · likes: <linked count>`, clean temporary files, and try to delete the source message. If the Short is over 10 minutes or 50 MB, the bot should reply with a local limit-specific error instead of sending video.
- YouTube Shorts require a runtime container with Node.js 22+: `yt-dlp` runs with `--js-runtimes node` to solve YouTube EJS challenges.
- Reddit video, Instagram Reels, and YouTube Shorts use a single pipeline: `yt-dlp metadata -> duration cap -> yt-dlp download -> ffprobe -> ffmpeg normalize -> ffprobe -> sendVideo`. Videos longer than 600 seconds are not downloaded or converted, and videos larger than 50 MB are rejected. Normalization runs one process at a time through `nice -n 19 ffmpeg -preset veryfast`, produces H.264/AAC MP4, `yuv420p`, `SAR 1:1`, `color_range tv`, removes metadata, and applies `+faststart`. The normalized output dimensions are passed to Telegram as `width`/`height`, with `duration` and `supports_streaming`.
- Run `/publish` in the operator private chat: check reply mode, no-reply mode, and media albums; the copy should appear in the `adminDefaultChatId` configured in `telegram-access-config.json` as a bot message without source-author attribution. Also verify the local fallback when `adminDefaultChatId` is unset.
- Media providers run only when matching keys are configured.
- Lookup smoke before production rollout can be done with a direct request to the Tavily API.

## Localization

- Keep runtime user-facing text and language-specific regex patterns in `src/locales/locale.ts`.
- Runtime code should import the neutral `text` and `patterns` exports instead of embedding localized strings.
- When adding a new local fallback, label, assistant display name, or target-language detection pattern, add it to the locale file first and consume it from the feature code.
