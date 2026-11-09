# Development

## Local Setup

Follow the [quick start](../README.md#quick-start).
`npm run dev` watches source; `npm run build && npm start` runs the compiled bot.
Startup applies SQLite migrations; `npm run migrate` runs them separately.

Native media downloads need `yt-dlp[default,curl-cffi]`, `gallery-dl`, `ffmpeg`,
and `ffprobe`. To use the Docker images:

```bash
docker compose up -d --build
docker compose logs --tail=100 -f
```

`data/` must be writable by UID/GID 1000. Temporary media is shared through
`media/`. Both worker URLs must be set to use HTTP workers; without them, the
bot runs local CLI tools.

## Configuration

The [environment example](../config/examples/.env.example) lists common settings.
Required: `TELEGRAM_BOT_TOKEN`, `LLM_API_KEY`, `TELEGRAM_CHAT_CONFIG_PATH`, and
`TELEGRAM_ACCESS_CONFIG_PATH`. Remove unused optional provider placeholders.
The full environment schema is in [schema.ts](../src/config/env/schema.ts);
fixed defaults and limits are in [runtime/](../src/config/runtime/).

### Providers

| Variables | Service |
| --- | --- |
| `LLM_BASE_URL`, `LLM_REPLY_MODEL`, `LLM_API_KEY` | OpenAI-compatible generation. |
| `DEEPSEEK_API_KEY`, `TAVILY_API_KEY` | Web search. |
| `GLADIA_API_KEY` | Audio/video transcription. |
| `CLOUDFLARE_AI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` | Image descriptions. |
| `OCR_SPACE_API_KEY` | OCR. |
| `YANDEX_SPEECHKIT_API_KEY` | Text-to-speech. |

DeepSeek Search reuses `LLM_API_KEY` when the LLM endpoint has the official
DeepSeek origin; other endpoints need `DEEPSEEK_API_KEY` or Tavily. DeepSeek
failures and empty results try Tavily when configured. `LOOKUP_TIMEOUT_MS`
applies per provider attempt.

### Telegram Access

The [chat config](../config/examples/telegram-chat-config.example.json) is an
array of groups. Each entry sets command flags, feature flags, and Reddit source
lists. Enabled `/meme` and `/sex` require non-empty `reddit_sources.meme` and
`reddit_sources.sex`, respectively. `features.deploy_announcements` enables
update notices.

The [access config](../config/examples/telegram-access-config.example.json)
sets `adminUserId` and `linkUserIds`. See the [README](../README.md#usage) for
access and invocation rules. Invalid JSON, duplicate chat IDs, and unknown
fields fail startup. Restart the bot after configuration changes.

### Spontaneous Messages

Each chat entry can include `spontaneous`:

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Allow unsolicited messages in this group. |
| `probability` | `0.03` | Chance per eligible message, from 0 to 1. |
| `cooldownSeconds` | `900` | Minimum interval between attempts. |
| `minMessages` | `20` | New human text messages required between attempts. |
| `maxAttemptsPerHour` | `3` | Attempt limit in a rolling hour. |

Attempts include skips and failures and persist across restarts. This setting
is independent of `features.assistant`. Draft/context limits are in
[spontaneous.ts](../src/config/runtime/spontaneous.ts).

### Cookies

| Variable | File format and use |
| --- | --- |
| `REDDIT_COOKIE_HEADER_PATH` | Raw Cookie header for subreddit listings; takes precedence over Netscape cookies. |
| `REDDIT_COOKIES_PATH` | Netscape cookies for yt-dlp and listings without a raw header. |
| `INSTAGRAM_COOKIES_PATH` | Netscape cookies for Instagram downloads. |
| `YOUTUBE_COOKIES_PATH` | Netscape cookies for YouTube downloads. |

Remove `REDDIT_COOKIE_HEADER_PATH` if that file is absent. Listings require the
chosen cookie file to be readable. HTTP 401/403 with a raw header notifies the
operator to refresh it. Updating the header does not update the Netscape file.
Instagram auth/rate-limit failures lock the source until its cookie file's
modification time changes.

Reddit yt-dlp extraction requires Chrome impersonation. Check the installed tool:

```bash
docker compose run --rm --no-deps --entrypoint yt-dlp video --list-impersonate-targets
```

The output should list Chrome through `curl_cffi`.

## Checks and Evals

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Biome fixes are available through `npm run lint:fix`. Database tests skip if
the native `better-sqlite3` binding cannot load; run checks with Node.js 24.

Evals load `.env` and call the configured LLM. Intent evals use fixture search
results; conversation evals test research routing without running a live search.
Only conversation evals support `--dry-run`:

```bash
npm run eval:intents -- --intent=answer
npm run eval:intents -- --intent=spontaneous
npm run eval:conversation -- --dry-run
npm run eval:conversation -- --id=FIXTURE_ID --variants=A --repetitions=1
```

Reports go to `.eval-runs/`. Intent results marked `needs_review` need manual
semantic review. Conversation evals compare these history variants:

| Variant | Input |
| --- | --- |
| A | Production history and prompts. |
| B | History without bot messages. |
| C | Bot messages only in the trigger's reply ancestry. |
| D | Current planner prompt against saved A inputs. |

D requires a baseline manifest:

```bash
npm run eval:conversation -- --baseline-manifest=.eval-runs/SAVED_RUN/manifest.json
```

Conversation defaults are two repetitions and concurrency three; override with
`--repetitions` and `--concurrency`. Review the generated answers in the reports.

## Production

### VPS Setup

Prepare Linux amd64, Docker Engine, Compose **2.30.0+**, and Bash.
The SSH deployment user needs Docker access and a GHCR login with read access
to all three image packages. Enable Docker at boot. Default application path:
`/srv/telegram-bot`. Service definitions are in
[compose.yml](../compose.yml).

| Path | Contents / permissions |
| --- | --- |
| `.env` | Literal `KEY=value` lines, without shell quotes; deployment-user ownership, mode 0600. |
| `data/` | `bot.sqlite`, chat/access JSON, cookies, and persistent files; UID/GID 1000. |
| `media/` | Shared temporary files; UID/GID 1000. |
| `deploy/` | Generated announcement metadata, mounted read-only. |

Workers read cookies under `/app/data`. Create `data/` and `media/` and prepare
`.env` before the first deploy. Actions uploads Compose, image references, and
announcement metadata; application data stays on the VPS.

### GitHub Settings and CI/CD

In the `production` environment, keep `SSH_PRIVATE_KEY` and verified
`SSH_KNOWN_HOSTS`; restrict deployment to `main`. Repository Actions variables:

| Variable | Value |
| --- | --- |
| `SSH_HOST` | VPS hostname or IP. |
| `SSH_USER` | Defaults to `github-deploy`. |
| `DEPLOY_DIR` | Defaults to `/srv/telegram-bot`; absolute path using letters, digits, `/`, `_`, and `-`. |

[CI](../.github/workflows/ci.yml) runs code checks, builds three amd64 images,
and smoke-tests them before publishing those same images to GHCR. PRs do not
publish. [Deploy](../.github/workflows/deploy.yml) runs on non-documentation
pushes to `main` or manually through **Actions → Deploy**. GitLab CI builds
its own images independently.

Deployment pulls image digests and validates configuration, stops services,
then starts the new version and waits for health. Actions concurrency
prevents overlapping deployments. Failure prints state/logs and
fails the workflow without rolling back images or SQLite.

### Operations

From the application directory, define:

```bash
compose() { docker compose --env-file images.env -f compose.yml "$@"; }
```

| Operation | Command |
| --- | --- |
| Status | `compose ps --all` |
| Logs | `compose logs --tail=100 -f` |
| Stop | `compose stop` |
| Start | `compose up -d --no-build --wait --wait-timeout 300` |
| Restart a worker | `compose restart video` |

After editing `.env` or JSON, validate and recreate the bot:

```bash
compose config --quiet
compose run --rm --no-deps --entrypoint node bot --input-type=module -e \
  'import { getEnv } from "./dist/src/config/env/index.js"; getEnv();'
compose up -d --no-deps --no-build --force-recreate --wait --wait-timeout 300 bot
```

`config --quiet` avoids printing secrets. The validator does not poll Telegram
or open SQLite. Docker restarts exited containers; intentionally stopped
containers stay stopped after reboot. Health failure alone does not restart
them; see [healthcheck behavior](architecture.md#containers).

Logs rotate at 3 × 10 MB per service. For abandoned temporary files, add a host
cleanup policy (adjust the path for custom `DEPLOY_DIR`):

```bash
printf '%s\n' 'd /srv/telegram-bot/media 0700 1000 1000 1d' | sudo tee /etc/tmpfiles.d/telegram-bot.conf >/dev/null
sudo systemctl enable --now systemd-tmpfiles-clean.timer
```

### Backup and Restore

Pause deployments during maintenance. As root, from the application directory
using the `compose` helper above:

```bash
umask 077
compose stop --timeout 30
tar -czf /var/backups/telegram-bot-$(date -u +%Y%m%dT%H%M%SZ).tar.gz .env data compose.yml images.env deploy
compose up -d --no-build --wait --wait-timeout 300
```

Keep a protected copy off-VPS. Test extraction and run
`sqlite3 data/bot.sqlite 'PRAGMA quick_check;'` on the extracted database;
it should return `ok`. Back up the whole stopped data directory, including
WAL/SHM files when present.

To restore, stop services and replace the whole `data/` directory with the
saved copy, preserving UID/GID 1000. Restore `.env` if needed, validate, then
start. Keep restored SQLite and its WAL/SHM together.

## Manual Smoke Checks

Use a test bot/chat to check:

- Assistant mentions/replies, edited context, and access restrictions.
- `/translate`, `/read`, and `/transcribe`, including missing reply targets.
- Spontaneous messages, disabled groups, frequency limits, and replies to them.
- Reddit image/GIF/gallery/video; Instagram Reels/carousels; YouTube and TikTok.
- Captions, spoilers, album order, source deletion, cleanup, and size limits.
- Enabled providers, search fallback, and cookie refresh after an auth failure.
