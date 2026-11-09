# Development

## Local Setup

Use Node.js 24 and npm 11+. Follow the [quick start](../README.md#quick-start)
to create `.env` and the two JSON config files before running migrations.

Native media features need `yt-dlp` (with `default,curl-cffi` extras),
`gallery-dl`, `ffmpeg`, and `ffprobe` on PATH. YouTube also needs Node.js.
Alternatively, run the [three-container Compose setup](#local-docker).

## Configuration

[Example environment](../config/examples/.env.example) and
[environment schema](../src/config/env/schema.ts) list the supported settings.
Required: `TELEGRAM_BOT_TOKEN`, `LLM_API_KEY`, `TELEGRAM_CHAT_CONFIG_PATH`,
and `TELEGRAM_ACCESS_CONFIG_PATH`. Replace `your-*` placeholders; remove unused
optional keys or validation will reject them.

| Settings                                                                | Purpose                                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `LLM_BASE_URL`, `LLM_REPLY_MODEL`                                       | OpenAI-compatible endpoint and model.                                       |
| `LLM_REPLY_TEMPERATURE`, `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`            | Generation settings; retries do not apply to search.                        |
| `SQLITE_PATH`                                                           | Database file; defaults to `data/bot.sqlite`.                               |
| `MEDIA_VIDEO_URL`, `MEDIA_GALLERY_URL`                                  | HTTP workers; configure both or neither. Neither means local CLI execution. |
| `DEEPSEEK_API_KEY`, `TAVILY_API_KEY`                                    | Search and optional failover.                                               |
| `LOOKUP_TIMEOUT_MS`, `LOOKUP_MAX_RESULTS`                               | Per-provider search timeout (default 7 seconds) and result limit.           |
| `GLADIA_API_KEY`                                                        | Voice/audio/video-note recognition and video transcription.                 |
| `CLOUDFLARE_AI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `OCR_SPACE_API_KEY`   | Image description and OCR.                                                  |
| `YANDEX_SPEECHKIT_API_KEY`                                              | Text-to-speech.                                                             |
| `LOG_LEVEL`, `LOG_COLOR`, `LOG_LLM_TEXT`                                | Logging; LLM text logging contains previews, not full prompts/responses.    |
| `REPLY_MIN_TYPING_MS`, `REPLY_MAX_TYPING_MS`, `REPLY_TYPING_REFRESH_MS` | Telegram typing indication.                                                 |

Search reuses `LLM_API_KEY` only when `LLM_BASE_URL` has the official DeepSeek
origin. Other LLM endpoints need a separate `DEEPSEEK_API_KEY` or Tavily key.
DeepSeek failures/empty results notify the admin and try Tavily once.
Two research queries can run in parallel; sequential provider failover can
take twice the configured timeout.

### Telegram Access

The chat config is an array; see the
[example](../config/examples/telegram-chat-config.example.json).

- `commands`: `translate`, `read`, `transcribe`, `meme`, `sex`.
- `features`: `assistant`, `direct_links`, `deploy_announcements`.
- `reddit_sources.meme` and `reddit_sources.sex`: per-chat subreddit lists,
  required and non-empty when the matching command is enabled.

Legacy `commands.answer/summarize/decide` flags only supply the assistant flag
when `features.assistant` is omitted. Their slash commands are retired.
Invalid entries, duplicate chat IDs, and unreadable config files fail startup.

The [access config](../config/examples/telegram-access-config.example.json)
sets `adminUserId` and optional `linkUserIds`. The operator can use the assistant
and links privately; link-only users cannot invoke the assistant or commands.
Disable BotFather privacy mode or grant the necessary administrator access
to receive ordinary group messages. Deleting source links also needs permissions.

### Spontaneous Messages

Each chat entry accepts an optional `spontaneous` object:

| Field | Default | Contract |
| ----- | ------- | -------- |
| `enabled` | `false` | Group chats only; independent of `features.assistant`. |
| `probability` | `0.03` | Fraction in 0..1 per eligible message; 0 disables attempts. |
| `cooldownSeconds` | `900` | Positive integer. |
| `minMessages` | `20` | 1..1,000 new human text messages between attempts. |
| `maxAttemptsPerHour` | `3` | 1..60 attempts in a rolling hour. |

Restart after configuration changes. Skips, errors, and unsuccessful draft
generation consume attempts; limits persist across restarts. Corpus retention
follows normal message retention. Fixed generation and context limits are in
[spontaneous.ts](../src/config/runtime/spontaneous.ts).

Events: `spontaneous_skipped`, `spontaneous_adapted`, `spontaneous_sent`,
`spontaneous_failed`.

### Cookies and Video Tools

| Setting                     | Used by                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `REDDIT_COOKIE_HEADER_PATH` | HTTP subreddit listings for `/meme` and `/sex`; takes precedence over Netscape cookies. |
| `REDDIT_COOKIES_PATH`       | yt-dlp extraction, and subreddit listings without a raw header.                         |
| `INSTAGRAM_COOKIES_PATH`    | Instagram yt-dlp/gallery-dl extraction.                                                 |
| `YOUTUBE_COOKIES_PATH`      | YouTube yt-dlp extraction.                                                              |

Unset `REDDIT_COOKIE_HEADER_PATH` if you do not supply that file. A configured
header rejected with HTTP 401/403 produces an admin notification. Updating it
does not update the Netscape file used by yt-dlp.

Reddit extraction uses `--impersonate chrome`; both Dockerfiles install yt-dlp's
`curl-cffi` extra. Workers use temporary writable cookie copies with mode `0600`.
Missing yt-dlp cookie files start an empty private jar.

Instagram auth/rate-limit failures lock the source in SQLite. Update its cookie
file to allow another attempt; repeated requests alone do not clear the lock.

Video limits and timeouts are configured in
[reddit-media.ts](../src/config/runtime/actions/reddit-media.ts).

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run dev` watches source; `npm start` runs the build. `npm run migrate`
applies database migrations. Use `npm run format` or `npm run lint:fix` to apply
Biome fixes. Test native SQLite support with Node 24: database suites skip
when the installed `better-sqlite3` binary cannot load.

Keep user-facing strings and language patterns in `src/locales/locale.ts`.
Add prompt behavior cases to eval fixtures; unit tests should cover assembly,
validation, and escaping rather than exact instructional prose.

## Evaluations

Both CLIs load `.env`. Only `eval:conversation` supports `--dry-run`, which
prepares the experiment without LLM calls; `eval:intents` calls the model.
Use fixture IDs with `--id`:

```bash
npm run eval:intents -- --intent=answer
npm run eval:intents -- --id=FIXTURE_ID
npm run eval:intents -- --intent=spontaneous
npm run eval:conversation -- --dry-run
npm run eval:conversation -- --variants=A --repetitions=1
```

Intent evals check routing, discussion graphs, context selection, media, and
answers against fixture web evidence; no live web search. Reports are saved
under `.eval-runs/<UTC timestamp>/` after each fixture. Errors are recorded;
remaining fixtures continue. Failures exit nonzero; `needs_review` requires
manual semantic assessment.

Spontaneous fixtures check adaptation, send/skip decisions, schema validity,
and one-call execution using fixed drafts. `spontaneous-followup-*` checks
ordinary assistant behavior with labeled bot history. Semantic review covers
context fit, draft retention, attribution, and task switching. Invalid output
fails the eval even when production suppresses delivery.

Conversation evals default to two repetitions, concurrency three (maximum four):

| Variant | Change                                                 |
| ------- | ------------------------------------------------------ |
| A       | Production prompts and history.                        |
| B       | Remove all bot replies, including the explicit target. |
| C       | Keep bot replies only in the triggering reply ancestry. |

History variants apply after budget fitting and preserve human messages.
`direct`/`clarify` run both LLM stages; `research` checks routing only.
Artifacts: `.eval-runs/conversation-<UTC timestamp>/` with `manifest.json`,
`settings.json`, `results.jsonl`, and `results.json`. Execution/schema errors
exit nonzero; qualitative checks need review.

Compare a saved planner prompt (A) with the current one (D):

```bash
npm run eval:conversation -- --baseline-manifest=.eval-runs/SAVED_RUN/manifest.json
```

Variant D requires `--baseline-manifest` and compares the current planner with
saved A prompts. Both use the current generator and identical user data.
Filters: `--id`, `--variants`, `--repetitions`, `--concurrency`.

## Local Docker

```bash
docker compose -f .github/compose.yml config --quiet
docker compose -f .github/compose.yml up -d --build
docker compose -f .github/compose.yml logs --tail=100 -f
docker compose -f .github/compose.yml down
```

The GitHub Dockerfile builds `bot`, `video`, and `gallery` targets. Containers
run as UID/GID 1000. `data/` must be writable by that user; workers mount it
read-only. Shared media uses a separate volume. No ports are published.

To check Reddit impersonation support:

```bash
docker compose -f .github/compose.yml run --rm --no-deps --entrypoint yt-dlp video --list-impersonate-targets
```

The output must list Chrome through `curl_cffi`.

## CI

GitHub [CI](../.github/workflows/ci.yml) runs on non-main pushes, PRs to main,
manual runs, and calls from Deploy. Documentation-only pushes/PRs are excluded.
It runs lint, typecheck, tests, builds all three images with Bake, and smoke-tests
the containers without external media sites. Publishing uses GHCR commit tags;
smoke tests and deployment use the resulting image digests.

[Deploy](../.github/workflows/deploy.yml) runs on non-documentation pushes to
`main` or manually from `main`. It calls CI, generates metadata, opens an SSH
tunnel, and applies Kubernetes manifests. The GitLab pipeline is independent:
its Bake file builds dev/prod images for amd64 and arm64; tagged releases publish
release metadata. It does not perform the GitHub K3s deployment.

## Production on K3s

The manifests target one Linux amd64 VPS. One Pod contains three containers;
`Recreate` prevents overlapping polling bots but causes brief downtime.
The data PVC uses K3s `local-path` storage (currently 1 GiB); temporary media uses
a 2 GiB emptyDir. Keep backups outside the VPS. Rollback restores images and
deploy metadata, not SQLite; Pod replacement discards unfinished jobs.

### Cluster and Data

Install K3s without Traefik or ServiceLB. Include `YOUR_VPS_HOST` in the API
certificate with `--tls-san YOUR_VPS_HOST`. External references are listed in
[research](research.md#operations).

Run setup on the VPS with an administrator kubeconfig, for example
`export KUBECONFIG=/etc/rancher/k3s/k3s.yaml` in a root shell:

```bash
kubectl apply -f .github/bootstrap.yml
kubectl -n telegram-bot create secret generic bot-env --from-env-file=.env
kubectl -n telegram-bot create secret docker-registry ghcr \
  --docker-server=ghcr.io --docker-username=YOUR_GITHUB_USER \
  --docker-password=YOUR_READ_PACKAGES_TOKEN
```

For `--from-env-file`, use literal values without shell quotes. Provider
credentials belong in `bot-env`; JSON configs and cookies belong in `/app/data`
on the PVC. Relative `data/...` paths in the example resolve there. Custom
worker cookie paths must also stay within `/app/data`. The GHCR token needs
`read:packages` and access to all three image packages.

Before importing existing data, stop the old bot and back up `data/`, including
SQLite WAL/SHM files. Use a temporary Pod to mount and populate the PVC:

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

Copy both JSON config files and required cookies, even for a fresh install.
Do not run the old bot with the same token after Kubernetes starts polling.
Keep the PVC when redeploying.

### Deployment Credentials

The workflows connect as the VPS OS user `github-deploy` and forward runner
`127.0.0.1:16443` to VPS `127.0.0.1:6443`. Configure SSH key authentication
and allow TCP forwarding for that user. The SSH destination is currently set
in both `deploy.yml` and `test-k3s.yml`; update both when changing VPS.

Kubernetes authentication is separate. Bootstrap creates ServiceAccount
`github-deploy` with namespace-scoped deployment/metadata permissions, without
Secret access. Export a scoped kubeconfig rather than the cluster-admin file:

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
kubectl --kubeconfig=github-deploy.kubeconfig config set-cluster k3s --server=https://127.0.0.1:16443 --tls-server-name=YOUR_VPS_HOST --certificate-authority="$ca_file" --embed-certs=true
kubectl --kubeconfig=github-deploy.kubeconfig config set-credentials github-deploy --token="$token"
kubectl --kubeconfig=github-deploy.kubeconfig config set-context production --cluster=k3s --user=github-deploy --namespace=telegram-bot
kubectl --kubeconfig=github-deploy.kubeconfig config use-context production
rm -f "$ca_file"
unset token
```

The kubeconfig endpoint must match the tunnel. `--tls-server-name` verifies
the API certificate against `YOUR_VPS_HOST`.
Rotate the token by replacing its Secret and updating GitHub.

In GitHub **Settings → Environments → production**, restrict deployment branches
to `main` and configure:

| Secret/variable              | Value                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `KUBE_CONFIG`                | Complete scoped kubeconfig.                                                                 |
| `SSH_PRIVATE_KEY`            | Private key for the VPS OS user.                                                            |
| `SSH_KNOWN_HOSTS`            | Verified SSH host-key entry for the workflow destination.                                   |
| `KUBECTL_VERSION` (variable) | kubectl version matching the cluster minor version; Deploy currently defaults to `v1.36.0`. |

Keep credential files out of Git and remove temporary local copies after
saving them in GitHub. Ensure Actions can publish GHCR packages and the cluster
can pull them. The **Test K3s Connection** workflow checks the tunnel and scoped
permissions; it currently pins kubectl separately.

### Rollout and Recovery

Run **Actions → Deploy → Run workflow** on `main` for the first rollout.
Later non-documentation pushes to `main` deploy automatically.

`.github/deploy.sh` mounts metadata from a ConfigMap named by commit and content
hash, applies the Deployment, and waits up to five minutes. A failed rollout
triggers undo when a previous Deployment exists. A failed apply or first
deployment has no automatic rollback. Metadata ConfigMaps are retained for
older revisions; remove only ones no retained revision uses.

For manual inspection or rollback, use an administrator kubeconfig on the VPS
(or open the SSH tunnel if using the exported deploy kubeconfig):

```bash
kubectl -n telegram-bot get pods
kubectl -n telegram-bot logs deployment/telegram-bot -c bot --tail=100
kubectl -n telegram-bot rollout undo deployment/telegram-bot
kubectl -n telegram-bot rollout status deployment/telegram-bot --timeout=300s
```

The bot waits up to 120 seconds for worker health before polling. Check both
`video` and `gallery` container logs if startup fails.

## Manual Smoke Checks

Use a separate test bot/chat and check:

- Assistant mentions, bare mentions, replies to its answers, interleaved topics,
  clarification follow-ups, disabled features, and rejected private users.
- `/translate`, `/read`, and `/transcribe` with valid and missing reply targets;
  confirm video transcription also works on a video sent by the bot.
- Edited messages change later context without sending another reply.
- Spontaneous generation, replies to generated messages, serious-context skips,
  frequency limits, and disabled/private/idle chats.
- Reddit image/GIF/gallery/video and Streamable posts; Instagram Reels and
  mixed carousels; YouTube Shorts; TikTok video and photo posts.
- Captions, sender attribution, spoilers, album order, source-link deletion,
  temporary-file cleanup, queue notices, and size/duration fallbacks.
- Reddit Chrome impersonation with cookies through a full download/upload.
  After an Instagram source lock, changing cookies permits another attempt.
- Live DeepSeek Search and Tavily failover separately; fixture evals do not
  verify provider access.
