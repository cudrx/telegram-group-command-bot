# Руководство По Разработке

## Требования

- Node.js `20` или `22` LTS
- npm `11+`
- токен Telegram-бота
- ключ OpenAI-compatible LLM API

## Основные Файлы

- `README.md` — обзор и быстрый старт.
- `docs/README.md` — структура Markdown-документации.
- `docs/architecture.md` — архитектура и потоки.
- `docs/development.md` — это руководство.
- `llm/assistant/base.md` — базовые инструкции ассистента.
- `llm/` — статические prompt-файлы.
- `src/config/env/` — схема окружения, значения по умолчанию и проверки.
- `scripts/` — миграции, eval-скрипты, metadata для деплоя, smoke-проверка weekly.

## Окружение

Обязательные переменные:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_ADMIN_ID`
- `LLM_API_KEY`

Часто используемые:

- `LLM_BASE_URL`
- `LLM_REPLY_MODEL`
- `LLM_PLANNER_MODEL`
- `LOG_LEVEL`
- `LOG_COLOR`
- `LOG_LLM_TEXT`
- `SQLITE_PATH`

Дополнительные провайдеры:

- `TAVILY_API_KEY` — поиск для `/decide` и `/answer`.
- `GLADIA_API_KEY` — транскрибация audio/video-note.
- `CLOUDFLARE_AI_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` — описание изображений.
- `OCR_SPACE_API_KEY` — OCR.
- `YANDEX_SPEECHKIT_API_KEY` — исходящая озвучка.

`.env.example` содержит плейсхолдеры. Проверка окружения отклоняет `your-*` значения, поэтому ключи дополнительных провайдеров нужно либо заменить, либо удалить/закомментировать.

## Локальный Запуск

```bash
npm install
cp .env.example .env
npm run migrate
npm run dev
```

Перед запуском замените обязательные значения в `.env`.

Если используете другого OpenAI-compatible провайдера, поменяйте:

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_REPLY_MODEL=deepseek-v4-flash
LLM_PLANNER_MODEL=deepseek-v4-flash
```

Для подробной отладки:

```dotenv
LOG_LEVEL=debug
LOG_LLM_TEXT=true
LOG_COLOR=true
```

`LOG_LLM_TEXT=true` пишет компактный trace и короткий preview, но не полный prompt/response.

## NPM-Скрипты

- `npm run dev` — локальный запуск через `tsx watch`.
- `npm run migrate` — создает или обновляет схему SQLite.
- `npm run lint` — `biome check`.
- `npm run lint:fix` — `biome check --write`.
- `npm run format` — `biome format --write`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — `vitest run`.
- `npm run build` — сборка в `dist/`.
- `npm start` — запуск собранного `dist/src/index.js`.
- `npm run eval:intents` — полный набор intent eval, отчеты в `.eval-runs/`.
- `npm run eval:intents -- --id=<fixture-id>` — один fixture.
- `npm run eval:intents -- --intent=<intent>` — fixtures одного intent.

Предпросмотр данных для недельного обзора без обращений к Telegram и LLM:

```bash
SQLITE_PATH=data/prod-smoke.sqlite TELEGRAM_CHAT_ID=-1001234567890 npm exec tsx scripts/weekly-smoke.ts
```

## Проверки

Для обычных изменений:

```bash
npm run lint
npm run typecheck
npm test
```

Для изменений времени выполнения, сборки или деплоя:

```bash
npm run build
```

Для изменений маршрутизации intent или prompt-контракта:

```bash
npm run eval:intents
```

## Локальный Docker

Корневой `compose.yml` запускает локальный контейнер с bind mounts.

```bash
npm run build
docker compose config
docker compose up -d
docker compose ps
docker compose logs bot --tail=100 -f
docker compose down
```

SQLite сохраняется в локальной `data/`.

Если Docker отвечает `permission denied`, используйте `sudo` или добавьте пользователя в группу `docker` и заново войдите в сессию.

## CI

Workflow CI: `.github/workflows/ci.yml`.

На `push` и `pull_request` выполняются:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`

## Продакшн-Деплой

Workflow деплоя: `.github/workflows/deploy.yml`.

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

На сервере рядом с compose-файлом деплоя должны быть `.env` и `data/`.

Минимальные значения на сервере:

```dotenv
GHCR_IMAGE=ghcr.io/<github-owner>/test-chatbot
IMAGE_TAG=latest
SQLITE_PATH=/app/data/bot.sqlite
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_ADMIN_ID=123456789
```

Ключи дополнительных провайдеров добавляются туда же.

Metadata деплоя пишется в серверный `data/deploy-metadata.json`; внутри контейнера бот читает его как `/app/data/deploy-metadata.json`.
Оповещение отправляется один раз на новый `sha` и дедуплицируется через SQLite `app_state`.

Откат:

1. На сервере выставить старый `IMAGE_TAG` в `.env`.
2. Выполнить `docker compose --env-file .env -f compose.yml pull bot`.
3. Выполнить `docker compose --env-file .env -f compose.yml up -d bot`.

## Ручные Smoke-Проверки

- Для Telegram smoke используйте отдельного тестового бота и тестовую группу.
- Сначала проверяйте явные `/answer`, `/summarize`, `/decide`, `/read`.
- `/answer` и `/read` требуют reply на целевое сообщение.
- `/weekly` проверяется из личного чата администратора и публикует результат в `TELEGRAM_CHAT_ID`.
- Провайдеры медиа запускаются только при наличии соответствующих ключей.
- Smoke-проверку поиска перед включением в продакшне можно сделать прямым запросом к Tavily API.

## Поддержка Документации

После изменений возможностей, архитектуры, рабочих процессов, деплоя или контракта окружения обновляйте:

- `README.md`
- `docs/architecture.md`
- `docs/development.md`
- `docs/README.md`, если поменялась структура Markdown-файлов

Проектные документы и планы реализации держать в существующей структуре `docs/superpowers/`, когда они действительно нужны.
Документация не должна становиться архивом всех завершенных задач.
