# Character Telegram Bot

Минимальная рабочая основа для Telegram-бота-персонажа на `Node.js + TypeScript + grammY + SQLite` с OpenAI-compatible LLM слоем.

## Что уже есть

- long polling через `grammY`
- локальная `SQLite`-база для чатов, сообщений и профилей участников
- chat-scoped память по участникам: `core` / `durable` / `volatile` факты
- human-first labels и chat-scoped aliases для deterministic participant resolution
- per-chat persona overrides через `config/personas/<chat_id>.md`
- дедупликация, supersede конфликтующих фактов и TTL для временной памяти
- глобальная persona-основа из [`config/persona.md`](./config/persona.md)
- доменная логика ответа: `mention` / `reply` / редкое самостоятельное вмешательство через structured intervention analysis
- causal reply context для ответов на сообщения бота без плоского replay всего recent-window
- evidence-bound social QA: бот не выдумывает устойчивые описания участников без памяти или свежего видимого контекста
- в MVP нет долгосрочной self-memory бота в reply и summary paths
- фоновый idle-summary после затихания чата
- единая per-chat координация reply и summary без overlap `LLM`-job'ов
- prompt hardening для transcript и structured JSON logs
- generic LLM-клиент для генерации реплик, structured intervention analysis и summary с timeout/retry
- `Vitest`-тесты, `TypeScript` typecheck и сборка
- `GitHub Actions` `CI` на `push` и `pull_request`
- автодеплой Docker image из `GHCR` на VPS после `push` в `main`

## Требования

- Node.js `20` or `22` LTS
- npm `11+`
- Telegram bot token
- LLM API key

## Локальный запуск

1. Установите зависимости.

```bash
npm install
```

2. Создайте локальный `.env` на основе примера.

```bash
cp .env.example .env
```

`.env.example` настроен под OpenAI-compatible провайдера по умолчанию. Если вы хотите использовать другого провайдера или модель, после копирования файла переопределите как минимум `LLM_BASE_URL`, `LLM_REPLY_MODEL` и `LLM_SUMMARY_MODEL`.
Если провайдер поддерживает OpenAI-style structured JSON через `response_format: { type: "json_object" }`, оставьте `LLM_SUMMARY_JSON_MODE=response_format`.
Если обычные reply-запросы работают, а summary падает из-за неподдерживаемого `response_format`, переключите `LLM_SUMMARY_JSON_MODE=prompt_only`: тогда бот будет просить строгий JSON только через prompt, без API-level structured-output флага.

3. Проверьте или отредактируйте базовую persona в [`config/persona.md`](./config/persona.md).

4. Если нужен отдельный образ для конкретного чата, создайте файл `config/personas/<chat_id>.md`.
   Бот автоматически добавит его поверх базовой persona только в этом чате.

5. Если это первичная установка или после изменения схемы, подготовьте SQLite-схему.

```bash
npm run migrate
```

6. Запустите бота в режиме разработки.

```bash
npm run dev
```

## Основные переменные окружения

- `TELEGRAM_BOT_TOKEN` или `BOT_TOKEN`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_REPLY_MODEL`
- `LLM_SUMMARY_MODEL`
- `LLM_SUMMARY_JSON_MODE`
- `LLM_TIMEOUT_MS`
- `LLM_MAX_RETRIES`
- `LOG_LLM_TEXT`
- `INTERJECT_PROBABILITY`
- `INTERJECT_COOLDOWN_MINUTES`
- `CHAT_IDLE_MINUTES`
- `MIN_MESSAGES_FOR_SUMMARY`
- `MESSAGE_CONTEXT_LIMIT`
- `MESSAGE_RETENTION_DAYS`
- `SQLITE_PATH`
- `PERSONA_FILE`

## Логи

По умолчанию бот пишет компактные multiline-логи для чтения глазами в `docker compose logs`.
Если нужно увидеть, что именно уходит в LLM и что возвращается, включите `LOG_LLM_TEXT=true`: появятся события `llm.reply.request/response`, `llm.summary.request/response` и `llm.intervention.request/response` с полными prompt/response секциями.

Цвет можно принудительно включить через `FORCE_COLOR=1`; отключить через стандартный `NO_COLOR=1`.

## Проверки

- `npm run migrate` (только при первичной установке или изменении схемы)
- `npm run typecheck`
- `npm test`
- `npm run build`

## Структура

- `src/domain` — правила ответа, structured intervention analysis и summary
- `src/storage` — `SQLite`, сообщения, participant memories и aliases
- `src/llm` — prompt helpers, reply generation, intervention analysis и OpenAI-compatible summary layer
- `src/transport` — нормализация входящих сообщений Telegram
- `docs/architecture.md` — архитектура и потоки данных
- `docs/development.md` — локальная разработка и CI
- `docs/backlog/ideas.md` — идеи на следующие версии

## Docker Deployment

Продакшн-деплой использует готовый Docker image из `GHCR`, а не собирает приложение на сервере.

- GitHub Actions после `push` в `main` прогоняет `typecheck`, `test` и `build`
- затем публикует image в `ghcr.io`
- после этого workflow по `SSH` обновляет deploy-артефакты на VPS и делает `docker compose pull && docker compose up -d`

`SQLite` не хранится внутри контейнера. Файл базы лежит на VPS в bind mount-папке `./data`, которая на сервере должна находиться рядом с `compose.yml`, например в `/opt/test-chatbot/data/bot.sqlite`.

## Local Docker Check

Для локальной проверки контейнера используется корневой [`compose.yml`](./compose.yml). Он запускает официальный `node:20-bookworm-slim`, а код, `dist/` и `node_modules/` монтируются с хоста. Поэтому локальный smoke-check не зависит от сборки production image.

1. Подготовьте `.env`, если его еще нет:

```bash
cp .env.example .env
```

2. Соберите приложение и проверьте compose-конфиг:

```bash
npm run build
docker compose config
```

3. Проверьте, что контейнер поднялся:

```bash
docker compose up -d
docker compose ps
docker compose logs bot --tail=50
```

Если `TELEGRAM_BOT_TOKEN` и `LLM_API_KEY` валидные, в логах должен появиться успешный старт long polling.

4. Остановите локальный контейнер:

```bash
docker compose down
```

Если команды Docker отвечают `permission denied while trying to connect to the docker API`, запустите их через `sudo` или добавьте пользователя в группу `docker`, затем перелогиньтесь.

## Provider Migration Note

Провайдер настраивается через `LLM_*`. Старые `QWEN_*` переменные окружения временно продолжают работать как алиасы. Но `LLM_*` и `QWEN_*` нельзя смешивать в effective runtime environment, независимо от того, приходят ли они из `.env`, shell exports или других источников: миграция должна быть целиком в одном namespace, потому что mixed namespaces parser отклоняет.

## Следующие версии

Идеи для развития вынесены в [`docs/backlog/ideas.md`](./docs/backlog/ideas.md).
