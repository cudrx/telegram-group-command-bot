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
- `REDDIT_COOKIE_HEADER_PATH` - optional file containing a browser `Cookie` header for Reddit requests. Takes priority over `REDDIT_COOKIES_PATH`. On HTTP 401/403, the bot notifies the admin to update this file.
- `REDDIT_COOKIES_PATH` - optional path to Netscape cookies for Reddit listing/direct video requests.
- `INSTAGRAM_COOKIES_PATH` - optional path to Netscape cookies for Instagram Reels.
- `YOUTUBE_COOKIES_PATH` - optional path to Netscape cookies for YouTube Shorts.

LLM:

- `LLM_BASE_URL`
- `LLM_REPLY_MODEL`
- `LLM_REPLY_TEMPERATURE`
- `LLM_TIMEOUT_MS`
- `LLM_MAX_RETRIES`

Behavior:

- `REPLY_MIN_TYPING_MS`
- `REPLY_MAX_TYPING_MS`
- `REPLY_TYPING_REFRESH_MS`

Lookup:

- `TAVILY_API_KEY` - external verification for assistant requests when the first model call returns research.
- `LOOKUP_TIMEOUT_MS` - timeout for each assistant search request, default 7,000 ms. The assistant uses this value directly without an additional scenario-specific cap; parallel searches share the same configured limit.
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

`TELEGRAM_CHAT_CONFIG_PATH` should point to a JSON array of chat policies. Each policy includes:

- `commands` - boolean flags for utility commands: `translate`, `read`, `transcribe`, `meme`, and `sex`. Retired `answer`, `summarize`, and `decide` keys are optional compatibility inputs; they do not register commands.
- `features` - boolean flags for `assistant`, `direct_links`, and `deploy_announcements`. If `assistant` is omitted, it inherits the logical OR of legacy `commands.answer`, `commands.summarize`, and `commands.decide`; explicit true/false overrides those flags. With neither new nor legacy flags it defaults to false.
- `reddit_sources` - optional per-chat subreddit lists for Reddit-backed commands:
  - `meme` is required and must be non-empty when `commands.meme=true`
  - `sex` is required and must be non-empty when `commands.sex=true`

Unknown command names, unknown feature names, duplicate chat ids, invalid JSON, and unreadable files all fail startup.

`TELEGRAM_ACCESS_CONFIG_PATH` should point to a JSON object with:

- `adminUserId` - required Telegram user id of the global operator.
- `linkUserIds` - optional array of Telegram user ids allowed to DM only supported direct media links.

`config/examples/.env.example` contains placeholders. Environment validation rejects `your-*` values, so optional provider keys should either be replaced or removed/commented out.

Runtime settings that are not secrets and do not require deploy-specific overrides live in `src/config/runtime/`. Values are grouped by scenario (`actions/answer`, `actions/read`, `actions/meme`, `actions/sex`) and external provider (`providers/llm`, `providers/media`, `providers/tts`, `providers/lookup`). Settings that differ between environments go through `src/config/env/schema.ts`; defaults come from runtime config.

## Assistant Context and Evaluation

`src/config/runtime/actions/answer.ts` holds experimental assistant context limits (the internal name does not register `/answer`): up to 80 candidates from a 128-message recent scan, up to 16 predecessors around an explicit target, and explicit reply ancestry up to 16 links. Heuristics prioritize reply ancestors, target neighbors, recency, request terms, and author participation. These scores are candidate retrieval hints, not confirmed conversation links. No full-history scan, background clustering, or extra retrieval round is used.

History is fitted once after cached media enrichment, preserving retrieval priorities. It uses at most an estimated 8,000 tokens and only the remaining space within the 16,000-token full prompt budget after instructions, target media, schema, and web evidence. Individual message text is clipped at 6,000 characters with a visible marker. Optional history is dropped before rejecting a request; the local fallback applies only when mandatory input alone exceeds the budget. Unrelated media recognition does not block a reply; unfinished neighboring media is marked unavailable. Estimates use UTF-8 bytes divided by three, not a provider tokenizer or billed usage. Tune these settings against real chats, latency, and API usage.

The first model decision is `direct`, `clarify`, or `research`, with numeric `context.messageIds` from the supplied candidate pool, capped at 64. Unknown/cross-chat IDs fail validation. The research call receives selected original messages and their available explicit parents. Direct answers and clarifications require one completion; research uses two, excluding configured transport retries and existing media recognition. A clarification does not search chat history or the web. Users continue through another explicit mention.

Assistant completions use `response_format: {type: 'json_object'}`. JSON mode ensures JSON syntax; the response schema is validated locally. The canonical context is `{"messageIds": [...]}`. A model-supplied array in `context` is wrapped into that object before the same numeric-ID, count, and candidate-membership checks. Strings, message objects, and unavailable IDs are rejected. This normalization does not make another model call.

`npm run eval:intents -- --intent=answer` covers summaries, disputes, interleaved conversations, local slang, irony, previous bot corrections, old reply chains, missing subjects, bare mentions, injection, and audio. Answer fixtures use production retrieval, cached-media enrichment, and prompt budget fitting, including media-priority and long-audio regression cases. Research checks cover the selected route, expected search purpose, and query terms before grounding against fixture evidence. Web evidence in this suite is fixture-provided; it tests LLM routing and grounding without making live Tavily calls. Reports retain the actual system/user prompts for each completion, route, selected IDs, context precision/recall against fixtures, call count, estimated prompt tokens, and LLM latency. Rubric checks are limited lexical checks and require human review for nuanced humor; they are not proof of production quality. Save a baseline from the previous revision before rollout when comparing quality and cost.

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

Replace required values in `.env` before starting, then edit `data/telegram-chat-config.json` and `data/telegram-access-config.json` with your real Telegram ids, command flags, feature flags, and per-chat Reddit source lists for `/meme` and `/sex`.

If you use a different OpenAI-compatible provider, change:

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_REPLY_MODEL=deepseek-v4-flash
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

Prompt unit tests cover executable composition behavior: loading registered files, inserting the selected runtime data, excluding data from inapplicable branches, escaping untrusted content, and building the provider request. They must not assert that prompt Markdown contains particular instructional sentences. Model-facing wording and output quality belong in eval fixtures rather than source-text assertions.

The reply-model prompt contract includes a `CURRENT_DATETIME` block with current Moscow date and time in plain text. This helps the LLM resolve relative dates correctly.

## Local Docker

Use the GitHub Compose file for local testing of all three containers:

```bash
docker compose -f .github/compose.yml config --quiet
docker compose -f .github/compose.yml up -d --build
docker compose -f .github/compose.yml logs --tail=100 -f
docker compose -f .github/compose.yml down
```

All containers run as `node:node` (UID/GID 1000). The `data` bind mount must be
writable by that user. Workers mount it read-only; they copy cookies before
running extractors. Media files use a separate named volume mounted at
`/media`. No media executables need to be placed in `data/bin`. There are no
published ports. The first build downloads apt/pip packages; later builds
cache tool installation separately from source compilation.

GitHub's `.github/Dockerfile` has three runtime targets. `bot` contains the
app and npm production dependencies. `video` contains the HTTP worker,
ffmpeg/ffprobe, yt-dlp, its EJS dependency, and Node.js. `gallery` contains the
HTTP worker and gallery-dl. Worker images do not include the bot's npm
packages. Tool versions are explicit build arguments and updates require an
image rebuild. `USER node:node` controls runtime privileges; it does not
reconfigure the host Docker daemon. No separate rootless BuildKit service is
required. Native and GitLab runs keep local CLI execution unless both
`MEDIA_VIDEO_URL` and `MEDIA_GALLERY_URL` are set.

Reddit-hosted video, Instagram Reels, and YouTube Shorts all use the same
pipeline: `yt-dlp metadata -> duration/early-size caps -> yt-dlp download ->
ffprobe -> ffmpeg normalize -> ffprobe -> sendVideo`.

Videos longer than 600 seconds are not downloaded or converted, and downloaded files are checked again with `ffprobe`. Direct video sends for Reddit, Instagram Reels, YouTube Shorts, `/meme`, and `/sex` use a 50 MB file cap because this project uses the standard Telegram Bot API rather than a local Bot API server. `yt-dlp` metadata also has a conservative 75 MB pre-download reject cap for clearly oversized selected formats; unknown or borderline metadata still goes through the normal download and final-size checks. Normalization runs one process at a time through `nice -n 19 ffmpeg -preset veryfast`, produces H.264/AAC MP4, `yuv420p`, `SAR 1:1`, `color_range tv`, removes metadata, and moves the moov atom to the beginning. After normalization, the bot probes the output dimensions and passes `duration`, `width`, `height`, and `supports_streaming` to Telegram `sendVideo`. YouTube Shorts use H.264 MP4 at `height<=854` to avoid oversized 720p/1080p variants for long Shorts. Reddit `fallback_url` and similar direct MP4 URLs are used only as metadata/video-post signals, not as download paths.

Heavy video jobs are queued in-process with bounded concurrency so only a small
number of video pipelines run at once across all chats, and only one such job
may run at once per chat. If a video job cannot start immediately, the bot
sends a short queue notice before the normal video status messages begin.

Media subprocesses have explicit hard timeouts for metadata fetch, video
download, probing, and normalization so a stuck `yt-dlp`, `ffprobe`, or
`ffmpeg` process cannot hold a queue slot forever.

Instagram has an additional source lock. If `yt-dlp` or `gallery-dl` returns auth/access
failures such as login-required or rate-limit responses, the bot stores a
persistent blocked state in SQLite and refuses new Instagram jobs before
starting another extractor. The block clears automatically only after the cookie file at
`INSTAGRAM_COOKIES_PATH` changes on disk.

## CI

`.github/workflows/ci.yml` runs on non-main pushes, PRs to main, and manual
runs. It is also a reusable workflow called by Deploy. It installs npm
dependencies, runs lint/typecheck/tests, and builds three images in one Bake
invocation. There is no dev/prod or architecture matrix; the runner's native
Linux architecture is used. Images share build stages and separate GHA caches.
Container smoke checks verify UID/GID, SQLite write access, CLI startup, HTTP
jobs, H.264/AAC encoding, ffprobe JSON, and Opus extraction without external
media sites. Main publishes commit-tagged images to GHCR and smoke-tests them
before deployment. There is no `latest` deployment tag.

GitLab keeps its original pipeline, Dockerfile contents, dev/prod targets,
architecture matrix, registry, and release jobs. Only paths changed:
`.gitlab/Dockerfile` and `.gitlab/docker-bake.hcl` now sit alongside its CI
files. No GitLab UI change is required.

## Production on K3s

This deployment targets one Linux amd64 VPS running K3s. It uses one Pod with
three containers, one persistent data claim, and a temporary media `emptyDir`.
There is no Helm, Argo CD, broker, Ingress, or load balancer. The production
pipeline applies `.github/deployment.yml`, waits up to five minutes, and
runs `rollout undo` on a failed update. Updates use `Recreate`: expect brief
downtime, with no overlapping long-polling bot processes. Initial deployment
failures have no previous revision to restore. Pod replacement discards
unfinished jobs. Database backups remain necessary; rollback restores code
and metadata, not database contents.

### One-time VPS setup

Install a single-node K3s server using the
[official installation instructions](https://docs.k3s.io/quick-start). Set
`--tls-san` to the VPS hostname/IP used by GitHub Actions. Traefik and ServiceLB
are unnecessary for this bot and can be disabled:

```bash
curl -sfL https://get.k3s.io -o /tmp/install-k3s.sh
sudo INSTALL_K3S_EXEC='server --disable traefik --disable servicelb --tls-san YOUR_VPS_HOST' sh /tmp/install-k3s.sh
sudo k3s kubectl get nodes
```

The following setup commands run on the VPS as an administrator with its K3s
kubeconfig. Keep `/etc/rancher/k3s/k3s.yaml` private; do not upload the admin
kubeconfig into GitHub. The Kubernetes API at `https://YOUR_VPS_HOST:6443`
needs to be reachable by the Actions runner with a valid TLS certificate.
Application ports 3000/8081/8082 stay private.

For example, run setup from a root shell on the VPS with
`export KUBECONFIG=/etc/rancher/k3s/k3s.yaml` before using plain `kubectl`.

From a checkout, create the namespace, local-path PVC, and scoped deploy role:

```bash
kubectl apply -f .github/bootstrap.yml
kubectl -n telegram-bot create secret generic bot-env --from-env-file=.env
kubectl -n telegram-bot create secret docker-registry ghcr \
  --docker-server=ghcr.io --docker-username=YOUR_GITHUB_USER \
  --docker-password=YOUR_READ_PACKAGES_TOKEN
```

Prepare `.env` from `config/examples/.env.example`, with literal values
without surrounding shell quotes for `--from-env-file`. Provider credentials
stay in this Kubernetes Secret. JSON chat/access files and cookies stay in
`/app/data` on the PVC. Defaults from the example resolve there. Custom cookie
paths must also be inside `/app/data`. The `ghcr` token needs `read:packages`
and access to all three image packages; a workflow's temporary GITHUB_TOKEN
is not suitable for future cluster pulls. The PVC is 5 GiB with K3s's
`local-path` storage class. Keep the PVC when redeploying. Back up its data
outside the VPS: single-node storage does not survive losing the server.

### Import existing data before first deployment

Stop the old Compose bot before copying SQLite so no process writes to it.
Back up the stopped `data` directory, including SQLite WAL/SHM files if present.
Use a temporary Pod that mounts the claim; this also binds K3s local-path
storage before the application starts:

```bash
kubectl -n telegram-bot apply -f - <<'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: data-import
spec:
  automountServiceAccountToken: false
  restartPolicy: Never
  containers:
    - name: import
      image: busybox:1.37.0
      command: [sh, -c, 'sleep 3600']
      volumeMounts:
        - { name: data, mountPath: /data }
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: bot-data
YAML
kubectl -n telegram-bot wait --for=condition=Ready pod/data-import --timeout=120s
kubectl -n telegram-bot cp data/. data-import:/data
kubectl -n telegram-bot exec data-import -- chown -R 1000:1000 /data
kubectl -n telegram-bot delete pod data-import
```

Copy your two JSON configuration files and cookie files even for a fresh
installation. `data/bin` is unnecessary. Do not restart the old bot after
Kubernetes begins polling with the same token. Verify the first deployment
with a separate test chat before depending on it in the main group.

### GitHub deployment credentials

`.github/bootstrap.yml` creates ServiceAccount `github-deploy` with permissions
inside `telegram-bot` only. It can update the deployment and metadata ConfigMaps
and inspect rollout state. It cannot read Secrets, delete PVCs, or administer
the cluster. The workload itself does not mount Kubernetes API credentials.

For this minimal VPS setup, create a manually managed service-account token
for GitHub's kubeconfig. Rotate it by replacing the Secret and updating the
GitHub environment secret. This is a static credential; a future OIDC setup
can replace it without changing the workload.

```bash
kubectl -n telegram-bot apply -f - <<'YAML'
apiVersion: v1
kind: Secret
metadata:
  name: github-deploy-token
  annotations:
    kubernetes.io/service-account.name: github-deploy
type: kubernetes.io/service-account-token
YAML
kubectl -n telegram-bot wait --for=jsonpath='{.data.token}' secret/github-deploy-token --timeout=60s
umask 077
token="$(kubectl -n telegram-bot get secret github-deploy-token -o jsonpath='{.data.token}' | base64 -d)"
ca_file="$(mktemp)"
kubectl -n telegram-bot get secret github-deploy-token -o jsonpath='{.data.ca\.crt}' | base64 -d > "$ca_file"
kubectl --kubeconfig=github-deploy.kubeconfig config set-cluster k3s --server=https://YOUR_VPS_HOST:6443 --certificate-authority="$ca_file" --embed-certs=true
kubectl --kubeconfig=github-deploy.kubeconfig config set-credentials github-deploy --token="$token"
kubectl --kubeconfig=github-deploy.kubeconfig config set-context production --cluster=k3s --user=github-deploy --namespace=telegram-bot
kubectl --kubeconfig=github-deploy.kubeconfig config use-context production
rm -f "$ca_file"
unset token
```

Wait for Kubernetes to populate the token Secret before exporting it. Store
`github-deploy.kubeconfig` securely; never commit it. After adding it to GitHub,
remove the temporary local credential file.

### GitHub UI

1. Repository **Settings → Environments**: create `production`, restrict its
   deployment branches to `main`, and add environment secret **KUBE_CONFIG**
   with the complete scoped kubeconfig above. Optional required reviewers can
   gate deployments. Add environment variable **KUBECTL_VERSION** matching the
   cluster's minor version (for example `v1.35.0` for a 1.35 cluster).
2. **Settings → Actions → General**: enable Actions and allow the actions used
   by these workflows. The Deploy workflow explicitly requests `packages: write`
   to publish GHCR images using GITHUB_TOKEN; no registry write PAT is needed.
3. Check each GHCR package grants this repository Actions access and grants
   the cluster's read token/account pull access. Keep commit tags referenced
   by retained Deployment revisions. Publishing new packages may require the
   organization to allow package creation.
4. Remove obsolete deployment secrets (`DEPLOY_HOST`, `DEPLOY_PORT`,
   `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_SSH_KEY`, `SERVER_GHCR_USERNAME`,
   `SERVER_GHCR_TOKEN`) after the first successful migration. They are no longer
   used by GitHub Actions. GitLab UI needs no changes.
5. Run **Actions → Deploy → Run workflow** on `main` for the first rollout.
   Later non-documentation pushes to main deploy automatically.

The deploy job no longer SSHs into the server, copies app assets, runs Compose,
or prunes Docker images. It uses the Kubernetes API. Deploy metadata is an
ConfigMap named by commit SHA and a content hash, mounted as
`/app/data/deploy-metadata.json`. It retains the existing announcement format
and SQLite deduplication. Metadata ConfigMaps are not automatically pruned so
rollback can still mount earlier ones. After retiring old revisions, an
administrator can remove their unreferenced metadata ConfigMaps.

Manual rollback:

```bash
kubectl -n telegram-bot rollout undo deployment/telegram-bot
kubectl -n telegram-bot rollout status deployment/telegram-bot --timeout=300s
kubectl -n telegram-bot logs deployment/telegram-bot -c bot --tail=100
```

## Manual Smoke Checks

- Use a separate test bot and test group for Telegram smoke checks.
- Start with explicit `@bot_username` questions, summary requests, disputes, and `/translate`, `/read`, `/transcribe`.
- Check bare mentions, full requests, replies to old human messages, and corrections replying to bot answers. Confirm replies without mentions remain silent. Cover direct, clarification, and research routes, disabled `features.assistant`, and link-only private users.
- Check two interleaved discussions and a question selecting only one, then a summary of both. Confirm `/answer`, `/summarize`, and `/decide` no longer trigger responses.
- Disable BotFather privacy mode or configure administrator access so normal group messages reach the bot for context. Missing Telegram history cannot be reconstructed from API knowledge.
- `/translate` and `/read` require a reply to the target message.
- `/transcribe` requires a reply to a Telegram video message. It should work on videos sent by users and videos sent by this bot, ignore command arguments and links, extract audio with `ffmpeg`, return the transcript as text, and avoid creating `media_artifacts` rows.
- `/translate` should return a local fallback for target-language content and translate other text/media blocks into the target language with source headings.
- Editing an already stored message should update future context without sending a new reply by itself.
- `/meme` and `/sex` make an external request to a Reddit top-month listing with auth from `REDDIT_COOKIE_HEADER_PATH` when present, otherwise from `REDDIT_COOKIES_PATH`. They select a fresh supported image/GIF/gallery/video post from their own subreddit pools, send media without replying to the command, download media to temporary files, and should clean them after successful dispatch and Telegram errors. Video posts require the video worker, or locally installed tools for native runs. Reddit NSFW/spoiler posts are allowed and sent with Telegram's spoiler flag; for galleries, the spoiler flag should be set on every item.
- Reddit GIF smoke: send a Reddit post whose `url` is an `i.redd.it/*.gif` and has no MP4 variant. The original GIF should be downloaded within the 50 MB cap and uploaded via `sendAnimation`, with caption/spoiler preserved and the temporary file removed. GIF sending does not require yt-dlp or ffmpeg.
- Reddit Streamable smoke: send a Reddit link to a post with a Streamable video. Verify that the bot sends the video with the Reddit caption.
- Direct Reddit media link smoke: start the video worker (or install local CLI tools for native runs), configure `REDDIT_COOKIE_HEADER_PATH` or `REDDIT_COOKIES_PATH`, then send a Reddit post URL with image, GIF, gallery, or `reddit_video` in a configured chat with `direct_links: true`, the operator private chat, or a private chat with a user from `linkUserIds` in `telegram-access-config.json`. The bot should send `sendPhoto`, `sendAnimation`, `sendMediaGroup`, or `sendVideo` without replying to the source message, include title/subreddit/upvotes, store post metadata, clean temporary files, and try to delete the source link message. Video sends should include the normalized file's `width`/`height`, `duration`, and `supports_streaming`. Reddit NSFW/spoiler media should be sent with Telegram's spoiler flag; for galleries, it should be set on every item. In groups, deleting the source message requires bot admin rights and disabled BotFather privacy mode when the link is sent without a command/mention.
- Direct Instagram Reels smoke: configure `INSTAGRAM_COOKIES_PATH`, then send `https://www.instagram.com/reel/<shortcode>/` in a configured chat with `direct_links: true`, the operator private chat, or a private chat with a user from `linkUserIds` in `telegram-access-config.json`. The bot should get metadata through `yt-dlp`, skip videos longer than 600 seconds, reject clearly oversized selected formats above 75 MB before download, download the Reel through `yt-dlp`, verify MP4 with `ffprobe`, normalize with `nice -n 19 ffmpeg -preset veryfast`, probe the normalized dimensions, send `sendVideo` without a reply using `width`/`height`, `duration`, and `supports_streaming`, caption it as `inst: <nickname> · likes: <linked count>`, clean temporary files, and try to delete the source message. If the Reel is over 10 minutes, clearly over the pre-download size cap, or over 50 MB after download/normalization, the bot should reply with a local limit-specific error instead of sending video.
- Direct Instagram/TikTok gallery smoke: start the gallery worker (or install gallery-dl locally for native runs), then send an Instagram `/p/<shortcode>/` carousel or TikTok `/photo/<id>` Photo Mode link. The bot should preserve source order, ignore TikTok soundtrack audio, download images with the normal per-image cap, and send one item or media groups split at Telegram's 10-item limit. For a mixed Instagram carousel, the whole operation should use the existing Instagram video queue, each video should pass through the shared `yt-dlp`/`ffprobe`/`ffmpeg` pipeline, and Telegram media groups should contain photos and videos in their original order. Temporary files should be cleaned and the source message deleted after a successful dispatch. Instagram extraction uses `INSTAGRAM_COOKIES_PATH` and the existing source lock.
- Instagram lock smoke: with a deliberately stale `INSTAGRAM_COOKIES_PATH`, send a Reel URL and verify the bot replies with the local Instagram-unavailable fallback and stores a blocked source state. Without changing the cookie file, send another Reel URL and verify `yt-dlp` does not start again. Replace the cookie file on disk, then send a new Reel URL and verify the bot allows one fresh attempt.
- Direct YouTube Shorts smoke: configure `YOUTUBE_COOKIES_PATH`, then send `https://youtu.be/<id>`, `https://www.youtube.com/watch?v=<id>`, or `https://www.youtube.com/shorts/<id>` in a configured chat with `direct_links: true`, the operator private chat, or a private chat with a user from `linkUserIds` in `telegram-access-config.json`. The bot should get metadata through `yt-dlp`, skip videos longer than 600 seconds, reject clearly oversized selected formats above 75 MB before download, download the Short as H.264 MP4 at `height<=854`, verify MP4 with `ffprobe`, normalize with `nice -n 19 ffmpeg -preset veryfast`, probe the normalized dimensions, send `sendVideo` without a reply using `width`/`height`, `duration`, and `supports_streaming`, caption it as `yt: <channel> · likes: <linked count>`, clean temporary files, and try to delete the source message. If the Short is over 10 minutes, clearly over the pre-download size cap, or over 50 MB after download/normalization, the bot should reply with a local limit-specific error instead of sending video.
- YouTube Shorts require a runtime container with Node.js 24: `yt-dlp` runs with `--js-runtimes node` to solve YouTube EJS challenges.
- Reddit video, Instagram Reels, and YouTube Shorts use a single pipeline: `yt-dlp metadata -> duration/early-size caps -> yt-dlp download -> ffprobe -> ffmpeg normalize -> ffprobe -> sendVideo`. Videos longer than 600 seconds are not downloaded or converted. Selected formats clearly above 75 MB are rejected before download when metadata includes reliable sizes, unknown size metadata is allowed through, and videos larger than 50 MB after download or normalization are rejected. Normalization runs one process at a time through `nice -n 19 ffmpeg -preset veryfast`, produces H.264/AAC MP4, `yuv420p`, `SAR 1:1`, `color_range tv`, removes metadata, and applies `+faststart`. The normalized output dimensions are passed to Telegram as `width`/`height`, with `duration` and `supports_streaming`.
- Media providers run only when matching keys are configured.
- Lookup smoke before production rollout can be done with a direct request to the Tavily API.

## Localization

- Keep runtime user-facing text and language-specific regex patterns in `src/locales/locale.ts`.
- Runtime code should import the neutral `text` and `patterns` exports instead of embedding localized strings.
- When adding a new local fallback, label, assistant display name, or target-language detection pattern, add it to the locale file first and consume it from the feature code.
