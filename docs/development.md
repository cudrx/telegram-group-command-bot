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
- [`docs/superpowers/plans/`](./superpowers/plans/) — rolling window для свежих design docs, ТЗ и implementation plans
- [`config/persona.md`](../config/persona.md) — базовый образ персонажа
- `config/personas/<chat_id>.md` — необязательный override для конкретного чата

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

Если используете другой OpenAI-compatible провайдер или модель, после копирования `.env.example` переопределите как минимум `LLM_BASE_URL`, `LLM_REPLY_MODEL` и `LLM_SUMMARY_MODEL`.
Если провайдер поддерживает OpenAI-style structured JSON через `response_format: { type: "json_object" }`, оставьте `LLM_SUMMARY_JSON_MODE=response_format`.
Если reply-запросы проходят, а summary-запросы отклоняются из-за `response_format`, переключите `LLM_SUMMARY_JSON_MODE=prompt_only`. В этом режиме summary остаётся включённым, но JSON запрашивается только через prompt.

3. Отредактировать базовую persona:

```bash
$EDITOR config/persona.md
```

4. При необходимости создать per-chat override:

```bash
mkdir -p config/personas
$EDITOR config/personas/<chat_id>.md
```

5. Подготовить БД:

```bash
npm run migrate
```

6. Запустить бота:

```bash
npm run dev
```

## NPM Scripts

- `npm run dev` — локальный запуск через `tsx watch`
- `npm run migrate` — создаёт `SQLite`-схему
- `npm test` — `Vitest`
- `npm run typecheck` — `TypeScript` без `emit`
- `npm run build` — сборка в `dist/`
- `npm start` — запуск собранного `dist/src/index.js`

## Local Docker Workflow

Для локального smoke-check контейнера используется корневой [`../compose.yml`](../compose.yml). Он запускает `node:20-bookworm-slim` и использует локальные `dist/`, `node_modules/`, `config/` и `.env` через bind mounts.

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
docker compose logs bot --tail=50
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
- начать с повышенного `INTERJECT_COOLDOWN_MINUTES`, чтобы бот не спамил;
- держать низкий `INTERJECT_PROBABILITY`, пока не станет понятна динамика.

## What Is Not Automated Yet

- миграции с версиями;
- интеграционные тесты с реальным Telegram API;
- smoke-тесты с реальным LLM-провайдером.

## Documentation Maintenance

После реализации каждого плана нужно просмотреть и при необходимости обновить как минимум:

- [`../README.md`](../README.md) — если изменились возможности, запуск, переменные окружения или деплой;
- [`./architecture.md`](./architecture.md) — если изменились инварианты, компоненты, потоки данных или модель БД;
- [`./development.md`](./development.md) — если изменились workflow, проверки, CI/CD, деплой, repair steps или maintenance-правила.

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

### SQLite Repair After Deploy

Run this only after deploying the code that removes bot self-memory from reply and summary paths. The commands below repair the production database for chat `-1002155313986` and bot `user_id = 7378889635`. They assume the example `DEPLOY_PATH` of `/opt/test-chatbot`; if your server uses a different deploy path, adjust `DB` and `BACKUP`.

1. Backup first:

```bash
DB=/opt/test-chatbot/data/bot.sqlite
BACKUP=/opt/test-chatbot/data/bot-before-bot-self-memory-removal-2026-04-11.sqlite
sqlite3 "$DB" ".backup '$BACKUP'"
```

2. Dry-run query before changing anything:

```bash
DB=/opt/test-chatbot/data/bot.sqlite
sqlite3 "$DB" -header -column <<'SQL'
SELECT COUNT(*) AS active_bot_memory_rows
FROM participant_memories
WHERE chat_id = -1002155313986
  AND user_id = 7378889635
  AND status = 'active';

SELECT chat_id, user_id, profile_summary_text
FROM chat_participants
WHERE chat_id = -1002155313986
  AND user_id = 7378889635;

SELECT chat_id, summary_text, summary_updated_at
FROM chats
WHERE chat_id = -1002155313986;
SQL
```

3. Repair transaction:

```bash
DB=/opt/test-chatbot/data/bot.sqlite
sqlite3 "$DB" <<'SQL'
BEGIN IMMEDIATE;

UPDATE participant_memories
SET status = 'rejected'
WHERE chat_id = -1002155313986
  AND user_id = 7378889635
  AND status = 'active';

UPDATE chat_participants
SET profile_summary_text = NULL,
    profile_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE chat_id = -1002155313986
  AND user_id = 7378889635;

UPDATE chats
SET summary_text = NULL,
    summary_updated_at = NULL
WHERE chat_id = -1002155313986;

COMMIT;
SQL
```

4. Verification queries:

```bash
DB=/opt/test-chatbot/data/bot.sqlite
sqlite3 "$DB" -header -column <<'SQL'
SELECT status, COUNT(*) AS rows
FROM participant_memories
WHERE chat_id = -1002155313986
  AND user_id = 7378889635
GROUP BY status
ORDER BY status;

SELECT chat_id, user_id, profile_summary_text
FROM chat_participants
WHERE chat_id = -1002155313986
  AND user_id = 7378889635;

SELECT chat_id, summary_text, summary_updated_at
FROM chats
WHERE chat_id = -1002155313986;
SQL
```

## Memory Model

Память об участниках хранится строго внутри каждого чата.

- `core` — почти неизменные факты;
- `durable` — долгоживущие, но потенциально изменяемые факты;
- `volatile` — временные факты с TTL;
- conflicting `single` memories supersede предыдущие значения;
- `profile_summary_text` теперь служит кэшем-выжимкой поверх structured memories.
- у бота нет отдельной long-term chat-local self-memory в MVP; bot-derived long-term memory не должна попадать в reply generation.
- при наличии `config/personas/<chat_id>.md` этот файл добавляется поверх базовой persona только для соответствующего чата.
- старые `messages` можно автоматически подчищать через `MESSAGE_RETENTION_DAYS`; удаляются только сообщения, уже покрытые `summary`, а небольшой сырой хвост сохраняется.
