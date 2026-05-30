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
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_ADMIN_ID`
- `TELEGRAM_LINK_USER_IDS` - optional comma-separated Telegram user ids allowed to DM only supported direct media links; their commands are ignored.
- `LLM_API_KEY`
- `REDDIT_COOKIES_PATH` - optional path to Netscape cookies for Reddit listing/direct video requests.
- `INSTAGRAM_COOKIES_PATH` - optional path to Netscape cookies for Instagram Reels.
- `YOUTUBE_COOKIES_PATH` - optional path to Netscape cookies for YouTube Shorts.

Common variables:

- `LLM_BASE_URL`
- `LLM_REPLY_MODEL`
- `LLM_PLANNER_MODEL`
- `LOG_LEVEL`
- `LOG_COLOR`
- `LOG_LLM_TEXT`
- `SQLITE_PATH`

Optional providers:

- `TAVILY_API_KEY` - lookup for `/decide` and `/answer`.
- `GLADIA_API_KEY` - audio/video-note transcription.
- `CLOUDFLARE_AI_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` - image description.
- `OCR_SPACE_API_KEY` - OCR.
- `YANDEX_SPEECHKIT_API_KEY` - outbound voice.

`.env.example` contains placeholders. Environment validation rejects `your-*` values, so optional provider keys should either be replaced or removed/commented out.

Runtime settings that are not secrets and do not require deploy-specific overrides live in `src/config/runtime/`. Values are grouped by scenario (`actions/answer`, `actions/read`, `actions/meme`) and external provider (`providers/llm`, `providers/media`, `providers/tts`, `providers/lookup`). Settings that differ between environments go through `src/config/env/schema.ts`; defaults come from runtime config.

## Local Run

```bash
npm install
cp .env.example .env
npm run migrate
npm run dev
```

Replace required values in `.env` before starting.

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
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_ADMIN_ID`

The server directory next to the deploy compose file should contain an environment file and persistent storage directory.

Minimum server values:

```dotenv
GHCR_IMAGE=ghcr.io/<github-owner>/telegram-group-command-bot
IMAGE_TAG=latest
SQLITE_PATH=/app/data/bot.sqlite
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_ADMIN_ID=123456789
```

Optional provider keys are added there as well.

Deploy metadata is written to persistent storage; inside the container the bot reads it as `/app/data/deploy-metadata.json`. The announcement is sent once per new `sha` and deduplicated through SQLite `app_state`.

Rollback:

1. Set the old `IMAGE_TAG` in the server `.env`.
2. Run `docker compose --env-file .env -f compose.yml pull bot`.
3. Run `docker compose --env-file .env -f compose.yml up -d bot`.

## Manual Smoke Checks

- Use a separate test bot and test group for Telegram smoke checks.
- Start with explicit `/answer`, `/translate`, `/summarize`, `/decide`, `/read`.
- Check `/answer` both as a reply and without a reply: without a reply, it answers the latest message before the command.
- `/translate` and `/read` require a reply to the target message.
- `/translate` should return a local fallback for target-language content and translate other text/media blocks into the target language with source headings.
- Editing an already stored message should update future context without sending a new reply by itself.
- `/meme` makes an external request to a Reddit top-week listing with cookies from `REDDIT_COOKIES_PATH`, selects a fresh supported image/gallery/video post, sends media without replying to the command, downloads media to temporary files, and should clean them after successful dispatch and Telegram errors. Video posts also need `yt-dlp` and `ffmpeg`. Reddit NSFW/spoiler posts are allowed and sent with Telegram's spoiler flag; for galleries, the spoiler flag should be set on every item.
- Direct Reddit media link smoke: make the standalone `yt-dlp` zipapp available inside the container as `/usr/local/bin/yt-dlp`, configure `REDDIT_COOKIES_PATH`, then send a Reddit post URL with image, gallery, or `reddit_video` in the work chat or admin private chat as a regular non-command message. The bot should send `sendPhoto`, `sendMediaGroup`, or `sendVideo` without replying to the source message, include title/subreddit/upvotes, store post metadata, clean temporary files, and try to delete the source link message. Video sends should include the normalized file's `width`/`height`, `duration`, and `supports_streaming`. Reddit NSFW/spoiler media should be sent with Telegram's spoiler flag; for galleries, it should be set on every item. In groups, deleting the source message requires bot admin rights and disabled BotFather privacy mode when the link is sent without a command/mention.
- Direct Instagram Reels smoke: configure `INSTAGRAM_COOKIES_PATH`, then send `https://www.instagram.com/reel/<shortcode>/` in the work chat, admin private chat, or a private chat with a user from `TELEGRAM_LINK_USER_IDS`. The bot should get metadata through `yt-dlp`, skip videos longer than 120 seconds, download the Reel through `yt-dlp`, verify MP4 with `ffprobe`, normalize with `nice -n 19 ffmpeg -preset veryfast`, probe the normalized dimensions, send `sendVideo` without a reply using `width`/`height`, `duration`, and `supports_streaming`, caption it as `inst: <nickname> · likes: <linked count>`, clean temporary files, and try to delete the source message.
- Direct YouTube Shorts smoke: configure `YOUTUBE_COOKIES_PATH`, then send `https://youtu.be/<id>`, `https://www.youtube.com/watch?v=<id>`, or `https://www.youtube.com/shorts/<id>` in the work chat, admin private chat, or a private chat with a user from `TELEGRAM_LINK_USER_IDS`. The bot should get metadata through `yt-dlp`, skip videos longer than 120 seconds, download the Short as H.264 MP4 at `height<=854`, verify MP4 with `ffprobe`, normalize with `nice -n 19 ffmpeg -preset veryfast`, probe the normalized dimensions, send `sendVideo` without a reply using `width`/`height`, `duration`, and `supports_streaming`, caption it as `yt: <channel> · likes: <linked count>`, clean temporary files, and try to delete the source message.
- YouTube Shorts require a runtime image with Node.js 22+: `yt-dlp` runs with `--js-runtimes node` to solve YouTube EJS challenges.
- Reddit video, Instagram Reels, and YouTube Shorts use a single pipeline: `yt-dlp metadata -> duration cap -> yt-dlp download -> ffprobe -> ffmpeg normalize -> ffprobe -> sendVideo`. Videos longer than 120 seconds are not downloaded or converted. Normalization runs one process at a time through `nice -n 19 ffmpeg -preset veryfast`, produces H.264/AAC MP4, `yuv420p`, `SAR 1:1`, `color_range tv`, removes metadata, and applies `+faststart`. The normalized output dimensions are passed to Telegram as `width`/`height`, with `duration` and `supports_streaming`.
- Run `/publish` in the admin private chat: check reply mode, no-reply mode, and media albums; the copy should appear in `TELEGRAM_CHAT_ID` as a bot message without source-author attribution.
- Media providers run only when matching keys are configured.
- Lookup smoke before production rollout can be done with a direct request to the Tavily API.

## Localization

- Keep runtime user-facing text and language-specific regex patterns in `src/locales/locale.ts`.
- Runtime code should import the neutral `text` and `patterns` exports instead of embedding localized strings.
- When adding a new local fallback, label, assistant display name, or target-language detection pattern, add it to the locale file first and consume it from the feature code.
