# GHCR Docker CI/CD Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Containerize the Telegram bot, publish a ready-to-run image to GHCR on every push to `main`, and redeploy that exact image to the VPS over SSH without rebuilding on the server.

**Architecture:** Keep the app as a single long-polling Node.js process with `SQLite` persisted on the host through a bind mount. Build and test on GitHub Actions, push immutable image tags to GHCR, then upload the deployment compose assets and run a small remote deploy script over SSH so the VPS only pulls and restarts the bot.

**Tech Stack:** Node.js 20, TypeScript, Docker, Docker Compose, GitHub Actions, GHCR, SSH

---

## File Map

- Create: `.dockerignore`
  Keep Docker build context small and avoid copying local secrets, SQLite data, test fixtures, and git metadata into the image build.
- Create: `Dockerfile`
  Multi-stage image that installs dependencies, builds TypeScript, and ships only runtime assets needed for `node dist/index.js`.
- Create: `deploy/compose.yml`
  Server-side Compose definition for the bot service, host-mounted SQLite storage, restart policy, and image tag interpolation.
- Create: `deploy/.env.server.example`
  Bootstrap template for `/opt/test-chatbot/.env` on the VPS, including runtime env vars and image coordinates used by Compose.
- Create: `deploy/remote-deploy.sh`
  Idempotent remote deploy entrypoint: create the data directory, login to GHCR, pull the tagged image, and restart only the bot service.
- Modify: `.github/workflows/ci.yml`
  Make CI useful for normal development by running verification on pull requests and branch pushes, not only after merge.
- Create: `.github/workflows/deploy.yml`
  Build, tag, and push the production image to GHCR on `push` to `main`, then upload deploy assets and execute the remote deploy script over SSH.
- Modify: `README.md`
  Add the container workflow, explain where `SQLite` lives in production, and document the manual bootstrap expectations.
- Modify: `docs/development.md`
  Document required GitHub secrets, server bootstrap steps, deploy flow, and rollback path.

### Task 1: Containerize The Runtime

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile`

- [ ] **Step 1: Confirm the container build currently fails because Docker assets do not exist**

Run: `docker build -t test-chatbot:local .`

Expected: FAIL with a message equivalent to `failed to read dockerfile` because the repository has no `Dockerfile` yet.

- [ ] **Step 2: Add the Docker ignore rules**

```dockerignore
.git
.github
.codex
node_modules
dist
data
.env
.env.*
docs
tests
coverage
npm-debug.log*
```

- [ ] **Step 3: Add a multi-stage production Dockerfile**

```Dockerfile
FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
COPY config ./config
COPY scripts ./scripts

RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config

RUN mkdir -p /app/data

CMD ["node", "dist/index.js"]
```

- [ ] **Step 4: Build the image and verify the runtime files are present**

Run: `docker build -t test-chatbot:local .`

Expected: PASS with the final image created locally.

Run: `docker run --rm test-chatbot:local sh -lc 'test -f dist/index.js && test -f config/persona.md && test -d /app/data'`

Expected: PASS with exit code `0` and no output.

- [ ] **Step 5: Commit the containerization slice**

```bash
git add .dockerignore Dockerfile
git commit -m "feat: add production docker image"
```

### Task 2: Add Server Deployment Assets

**Files:**
- Create: `deploy/compose.yml`
- Create: `deploy/.env.server.example`
- Create: `deploy/remote-deploy.sh`

- [ ] **Step 1: Confirm deployment asset validation currently fails**

Run: `docker compose --env-file deploy/.env.server.example -f deploy/compose.yml config`

Expected: FAIL because the `deploy/` files do not exist yet.

- [ ] **Step 2: Add the server Compose definition**

```yaml
services:
  bot:
    image: ${GHCR_IMAGE:?set GHCR_IMAGE}:${IMAGE_TAG:-latest}
    container_name: test-chatbot
    restart: unless-stopped
    init: true
    env_file:
      - .env
    environment:
      NODE_ENV: production
      SQLITE_PATH: /app/data/bot.sqlite
    volumes:
      - ./data:/app/data
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 3: Add the server environment template**

```dotenv
# Image coordinates
GHCR_IMAGE=ghcr.io/example/test-chatbot
IMAGE_TAG=latest

# Runtime
NODE_ENV=production

# Telegram
TELEGRAM_BOT_TOKEN=replace-me

# LLM / provider
LLM_API_KEY=replace-me
LLM_BASE_URL=https://api.deepseek.com
LLM_REPLY_MODEL=deepseek-chat
LLM_SUMMARY_MODEL=deepseek-chat
LLM_SUMMARY_JSON_MODE=response_format
LLM_TIMEOUT_MS=45000
LLM_MAX_RETRIES=2
LOG_LLM_TEXT=false

# Behavior
INTERJECT_PROBABILITY=0.12
INTERJECT_COOLDOWN_MINUTES=30
CHAT_IDLE_MINUTES=30
MIN_MESSAGES_FOR_SUMMARY=10
MESSAGE_CONTEXT_LIMIT=16
MESSAGE_RETENTION_DAYS=180
SUMMARY_SWEEP_INTERVAL_MS=60000

# Storage and persona
SQLITE_PATH=/app/data/bot.sqlite
PERSONA_FILE=config/persona.md
```

- [ ] **Step 4: Add the remote deploy script**

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_PATH:?DEPLOY_PATH is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${SERVER_GHCR_USERNAME:?SERVER_GHCR_USERNAME is required}"
: "${SERVER_GHCR_TOKEN:?SERVER_GHCR_TOKEN is required}"

mkdir -p "${DEPLOY_PATH}/data"

cd "${DEPLOY_PATH}"

echo "${SERVER_GHCR_TOKEN}" | docker login ghcr.io -u "${SERVER_GHCR_USERNAME}" --password-stdin

IMAGE_TAG="${IMAGE_TAG}" docker compose --env-file .env -f compose.yml pull bot
IMAGE_TAG="${IMAGE_TAG}" docker compose --env-file .env -f compose.yml up -d bot

docker image prune -f
```

- [ ] **Step 5: Validate the deployment assets locally**

Run: `docker compose --env-file deploy/.env.server.example -f deploy/compose.yml config`

Expected: PASS and render a single `bot` service with `./data:/app/data` mount and the interpolated image name.

Run: `bash -n deploy/remote-deploy.sh`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit the deployment-assets slice**

```bash
git add deploy/compose.yml deploy/.env.server.example deploy/remote-deploy.sh
git commit -m "feat: add deployment assets"
```

### Task 3: Wire CI And Auto-Deploy Workflows

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Broaden CI so it protects pull requests and branch pushes**

Replace `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  push:
  pull_request:
    branches:
      - main

jobs:
  verify:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm test

      - name: Build
        run: npm run build
```

- [ ] **Step 2: Add the deploy workflow that builds once and deploys the pushed commit**

Create `.github/workflows/deploy.yml` with:

```yaml
name: Deploy

on:
  push:
    branches:
      - main

permissions:
  contents: read
  packages: write

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm test

      - name: Build
        run: npm run build

      - name: Compute image name
        id: image
        run: echo "name=ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/test-chatbot" >> "$GITHUB_OUTPUT"

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ steps.image.outputs.name }}:latest
            ${{ steps.image.outputs.name }}:${{ github.sha }}

      - name: Load SSH key
        uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.DEPLOY_SSH_KEY }}

      - name: Trust deploy host
        run: |
          mkdir -p ~/.ssh
          ssh-keyscan -p "${{ secrets.DEPLOY_PORT }}" "${{ secrets.DEPLOY_HOST }}" >> ~/.ssh/known_hosts

      - name: Upload deploy assets
        run: |
          ssh -p "${{ secrets.DEPLOY_PORT }}" "${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}" \
            "mkdir -p '${{ secrets.DEPLOY_PATH }}'"
          scp -P "${{ secrets.DEPLOY_PORT }}" \
            deploy/compose.yml \
            deploy/remote-deploy.sh \
            "${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:${{ secrets.DEPLOY_PATH }}/"

      - name: Deploy to server
        run: |
          ssh -p "${{ secrets.DEPLOY_PORT }}" "${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}" \
            "chmod +x '${{ secrets.DEPLOY_PATH }}/remote-deploy.sh' && \
            DEPLOY_PATH='${{ secrets.DEPLOY_PATH }}' \
            IMAGE_TAG='${{ github.sha }}' \
            SERVER_GHCR_USERNAME='${{ secrets.SERVER_GHCR_USERNAME }}' \
            SERVER_GHCR_TOKEN='${{ secrets.SERVER_GHCR_TOKEN }}' \
            bash '${{ secrets.DEPLOY_PATH }}/remote-deploy.sh'"
```

- [ ] **Step 3: Perform local verification that still matters before pushing workflows**

Run: `npm run typecheck`

Expected: PASS

Run: `npm test`

Expected: PASS

Run: `npm run build`

Expected: PASS

Run: `docker build -t test-chatbot:workflow-check .`

Expected: PASS, confirming the workflow's image build command matches local reality.

- [ ] **Step 4: Commit the workflow slice**

```bash
git add .github/workflows/ci.yml .github/workflows/deploy.yml
git commit -m "feat: automate ghcr deployment"
```

### Task 4: Document Bootstrap, Secrets, And Rollback

**Files:**
- Modify: `README.md`
- Modify: `docs/development.md`

- [ ] **Step 1: Add production deployment guidance to the project README**

Insert a section equivalent to:

```md
## Docker Deployment

Продакшн-деплой использует готовый Docker image из `GHCR`, а не собирает приложение на сервере.

- GitHub Actions после `push` в `main` прогоняет `typecheck`, `test` и `build`
- затем публикует image в `ghcr.io`
- после этого workflow по `SSH` обновляет `compose.yml` на VPS и делает `docker compose pull && docker compose up -d`

`SQLite` не хранится внутри контейнера. Файл базы лежит на VPS в bind mount-папке `./data`, которая на сервере должна находиться рядом с `compose.yml`, например в `/opt/test-chatbot/data/bot.sqlite`.
```

- [ ] **Step 2: Add a concrete server bootstrap and secret checklist to the development guide**

Insert a section equivalent to:

```md
## Production Deploy

### GitHub Secrets

- `DEPLOY_HOST` — IP или домен VPS
- `DEPLOY_PORT` — SSH-порт сервера
- `DEPLOY_USER` — SSH-пользователь
- `DEPLOY_PATH` — каталог деплоя, например `/opt/test-chatbot`
- `DEPLOY_SSH_KEY` — приватный ключ, который GitHub Actions использует для входа на сервер
- `SERVER_GHCR_USERNAME` — GitHub username, у которого есть `read:packages`
- `SERVER_GHCR_TOKEN` — PAT с правом `read:packages` для `docker login ghcr.io` на VPS

### One-Time VPS Bootstrap

```bash
mkdir -p /opt/test-chatbot/data
cp deploy/.env.server.example /opt/test-chatbot/.env
```

После копирования замените плейсхолдеры в `/opt/test-chatbot/.env` на реальные значения и установите:

```dotenv
GHCR_IMAGE=ghcr.io/<github-owner>/test-chatbot
IMAGE_TAG=latest
SQLITE_PATH=/app/data/bot.sqlite
```

Первый деплой создаст или обновит `/opt/test-chatbot/compose.yml`, скачает нужный image tag из `GHCR` и перезапустит контейнер.

### Rollback

Чтобы откатиться на предыдущую версию, на VPS временно установите более старый `IMAGE_TAG` в `/opt/test-chatbot/.env` и выполните:

```bash
cd /opt/test-chatbot
docker compose --env-file .env -f compose.yml pull bot
docker compose --env-file .env -f compose.yml up -d bot
```
```

- [ ] **Step 3: Review the docs for consistency with the runtime**

Run: `rg -n "Docker Deployment|Production Deploy|DEPLOY_HOST|GHCR_IMAGE|SQLite" README.md docs/development.md`

Expected: PASS with the new sections present and wording consistent with `/app/data/bot.sqlite`.

- [ ] **Step 4: Commit the documentation slice**

```bash
git add README.md docs/development.md
git commit -m "docs: add docker deployment guide"
```

## Self-Review

- **Spec coverage:** The plan covers container packaging, GHCR publication, SSH deploy, server-side Compose bootstrap, runtime secret handling, persistent `SQLite`, CI changes, and rollback guidance.
- **Placeholder scan:** No `TODO`, `TBD`, or unresolved “figure it out later” steps remain; each task names exact files, commands, and code blocks.
- **Type and path consistency:** The same deployment paths and variables are used throughout: `deploy/compose.yml`, `deploy/remote-deploy.sh`, `DEPLOY_PATH`, `GHCR_IMAGE`, `IMAGE_TAG`, and `/app/data/bot.sqlite`.

## Execution Notes

- The remote `.env` on the VPS is the source of truth for runtime secrets.
- `SQLite` persists because Compose mounts `./data` from the host into `/app/data` inside the container.
- No separate migration container is needed because `DatabaseClient.open()` already creates the schema and runs in-place schema migration on startup.
