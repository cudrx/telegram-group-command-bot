# Development Guide

## Requirements

- `Node.js 20` or `22` LTS
- `npm 11+`
- Telegram bot token
- LLM API key

## Project Files

- [`README.md`](../README.md) — быстрый старт
- [`docs/README.md`](./README.md) — каноническая структура Markdown-документов
- [`docs/architecture.md`](./architecture.md) — устройство проекта
- [`docs/backlog/ideas.md`](./backlog/ideas.md) — идеи следующих версий
- [`docs/backlog/big-features.md`](./backlog/big-features.md) — крупные future-stage подсистемы
- [`docs/backlog/small-fixes.md`](./backlog/small-fixes.md) — небольшие reliability, safety и operations задачи
- [`docs/superpowers/plans/`](./superpowers/plans/) — rolling window для свежих design docs, ТЗ и implementation plans
- [`llm/assistant/base.md`](../llm/assistant/base.md) — базовые assistant instructions
- [`llm/`](../llm/) — статические prompt-файлы; `src/llm/` оставляет за собой безопасную сборку prompt context и LLM-вызовы

## Environment

Минимально нужны:

- `TELEGRAM_BOT_TOKEN`
- `LLM_API_KEY`

Полный список смотри в [`../.env.example`](../.env.example).

## Local Workflow

1. Установить зависимости:

```bash
npm install
```

2. Создать локальный `.env`:

```bash
cp .env.example .env
```

Если используете другой OpenAI-compatible провайдер или модель, после копирования `.env.example` переопределите как минимум `LLM_BASE_URL`, `LLM_REPLY_MODEL` и, если нужен отдельный дешёвый путь для `/summarize` и `/explain`, `LLM_FAST_REPLY_MODEL`.
Для подробной отладки входящих update и reply lifecycle установите `LOG_LEVEL=debug`. Для LLM trace установите `LOG_LLM_TEXT=true`: в логи попадут только компактные метаданные и короткий preview ответа, без полного prompt/response. Цвета включаются через `LOG_COLOR=true` или `FORCE_COLOR=1`; если цвет мешает парсингу, используйте `NO_COLOR=1`.

3. Отредактировать базовые assistant instructions:

```bash
$EDITOR llm/assistant/base.md
```

4. Подготовить БД:

```bash
npm run migrate
```

Локальную SQLite-базу можно удалить только для локального reset-теста. Production deploy не очищает БД: `deploy/compose.yml` монтирует `./data` в `/app/data`, а `remote-deploy.sh` только подтягивает image и перезапускает контейнер. Если нужна очистка production SQLite, делайте это отдельной осознанной maintenance-операцией.

5. Запустить бота:

```bash
npm run dev
```

## NPM Scripts

- `npm run dev` — локальный запуск через `tsx watch`
- `npm run migrate` — создаёт `SQLite`-схему
- `npm test` — `Vitest`
- `npm run typecheck` — `TypeScript` без `emit`
- `npm run build` — сборка в `dist/`
- `npm run eval:intents` — прогоняет все intent fixtures и пишет отчёты в gitignored `.eval-runs/`
- `npm run eval:intents -- --id=decide-laptop-value-dispute` — прогоняет один fixture
- `npm run eval:intents -- --intent=summarize` — прогоняет fixtures одного intent
- `npm start` — запуск собранного `dist/src/index.js`

## Local Docker Workflow

Для локального smoke-check контейнера используется корневой [`../compose.yml`](../compose.yml). Он запускает `node:20-bookworm-slim` и использует локальные `dist/`, `node_modules/`, `llm/` и `.env` через bind mounts.

1. Подготовить `.env`:

```bash
cp .env.example .env
```

2. Собрать `dist/` и проверить итоговый compose-конфиг:

```bash
npm run build
docker compose config
```

3. Поднять контейнер:

```bash
docker compose up -d
```

4. Проверить состояние и логи:

```bash
docker compose ps
docker compose logs bot --tail=100 -f
```

Для полного LLM input/output включите в `.env`:

```dotenv
LOG_LLM_TEXT=true
LOG_LEVEL=debug
LOG_COLOR=true
```

Затем перезапустите контейнер и смотрите логи:

```bash
docker compose up -d
docker compose logs bot --tail=200 -f
```

5. Остановить контейнер:

```bash
docker compose down
```

`SQLite` при этом сохраняется в локальной папке `./data`, которая монтируется в `/app/data` внутри контейнера.

Если Docker отвечает `permission denied while trying to connect to the docker API`, используйте `sudo` для этих команд или добавьте пользователя в группу `docker` и заново войдите в сессию.

## CI

Workflow лежит в [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml).

На `push` и `pull_request` он делает:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`

## Suggested Test Setup

Для нормального локального теста бота:

- завести отдельный тестовый Telegram bot token;
- отключить лишние чаты и использовать приватную тестовую группу;
- проверять сначала только явные `/explain`, `/summarize` и `/decide`; для `/explain` использовать reply на сообщение с вопросом;
- держать `LOG_LLM_TEXT=true` во время коротких ручных сессий, чтобы видеть компактный LLM trace: модель, размеры prompt/response, оценку токенов и короткий response preview; полный prompt и полный response в логи не пишутся;
- по логам проверять, почему бот ответил и какой lifecycle прошёл; полный prompt проверять через тесты prompt builders или временную локальную instrumentation, а не через production logs;
- после изменения intent routing запускать `npm run eval:intents` и смотреть console output вместе с файлами в `.eval-runs/`.

### Lookup Smoke Tests

Before enabling lookup in production:

1. Verify Tavily key:

```bash
set -a
source .env
set +a
curl -sS --fail-with-body https://api.tavily.com/search \
  -H "Authorization: Bearer $TAVILY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"Дора Мэйби Бэйби певицы кто такие","search_depth":"basic","max_results":3,"include_answer":false,"include_raw_content":false,"include_usage":true}'
```

2. Verify planner model with thinking disabled:

```bash
set -a
source .env
set +a
curl -sS --fail-with-body "$LLM_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3.6-flash","messages":[{"role":"user","content":"Return only JSON: {\"ok\":true}"}],"temperature":0,"max_tokens":20,"enable_thinking":false}'
```

## What Is Not Automated Yet

- миграции с версиями;
- интеграционные тесты с реальным Telegram API;
- smoke-тесты с реальным LLM-провайдером.
- автопроверка gitignored `.eval-runs/` как артефактов остаётся ручной.

## Documentation Maintenance

После реализации каждого плана нужно просмотреть и при необходимости обновить как минимум:

- [`../README.md`](../README.md) — если изменились возможности, запуск, переменные окружения или деплой;
- [`./architecture.md`](./architecture.md) — если изменились инварианты, компоненты, потоки данных или модель БД;
- [`./development.md`](./development.md) — если изменились workflow, проверки, CI/CD, деплой, repair steps или maintenance-правила;
- [`./backlog/ideas.md`](./backlog/ideas.md) — если идея уже реализована, устарела или стала точнее после работы;
- [`./backlog/small-fixes.md`](./backlog/small-fixes.md) — если малая рабочая заметка уже реализована, переехала в план или должна быть переформулирована;
- [`./superpowers/plans/`](./superpowers/plans/) — если план уже реализован и его устойчивые решения нужно перенести в основные документы.

`docs/superpowers/plans/` не является архивом всех завершённых работ. Держите там не больше 5 планов: когда появляются новые планы, удаляйте самые старые уже реализованные, а устойчивые решения переносите в основные документы.

## Production Deploy

Workflow деплоя лежит в [`../.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

### GitHub Secrets

- `DEPLOY_HOST` — IP или домен VPS
- `DEPLOY_PORT` — SSH-порт сервера
- `DEPLOY_USER` — SSH-пользователь
- `DEPLOY_PATH` — каталог деплоя, например `/opt/test-chatbot`
- `DEPLOY_SSH_KEY` — приватный ключ, который GitHub Actions использует для входа на сервер
- `SERVER_GHCR_USERNAME` — GitHub username, у которого есть `read:packages`
- `SERVER_GHCR_TOKEN` — PAT с правом `read:packages` для `docker login ghcr.io` на VPS
- `DEPLOY_NOTIFY_CHAT_ID` — Telegram chat id для deploy update announcements, сейчас `-1002155313986`

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
DEPLOY_NOTIFY_CHAT_ID=-1002155313986
```

Первый деплой создаст или обновит `/opt/test-chatbot/compose.yml`, скачает нужный image tag из `GHCR` и перезапустит контейнер.

### Deploy Update Announcements

Workflow деплоя записывает release metadata в `${DEPLOY_PATH}/data/deploy-metadata.json` перед рестартом бота. Внутри контейнера этот файл доступен как `/app/data/deploy-metadata.json`.

На старте бот сравнивает metadata `sha` с `app_state.last_announced_deploy_sha` в SQLite. Если sha ещё не объявлялся, бот просит `LLM_FAST_REPLY_MODEL` сформатировать короткое русское Telegram HTML-оповещение и отправляет его в `DEPLOY_NOTIFY_CHAT_ID`.

Sha сохраняется только после успешной отправки сообщения в Telegram. Ошибки чтения metadata, LLM или Telegram отправки логируются и не блокируют старт бота.

### Rollback

Чтобы откатиться на предыдущую версию, на VPS временно установите более старый `IMAGE_TAG` в `/opt/test-chatbot/.env` и выполните:

```bash
cd /opt/test-chatbot
docker compose --env-file .env -f compose.yml pull bot
docker compose --env-file .env -f compose.yml up -d bot
```

## V1 Notes

- База v1 хранит только event log в `chats` и `messages`.
- Runtime не читает summary/memory/aliases даже если старый production SQLite файл ещё содержит такие таблицы.
- Новая схема не создаёт `participants` и `chat_participants`.
- Per-chat overrides are not supported in this reset; only `llm/assistant/base.md` is used.
