# Telegram Chat Assistant

Минимальное v1-ядро Telegram chat assistant на `Node.js + TypeScript + grammY + SQLite` с OpenAI-compatible LLM слоем.

## Что уже есть

- long polling через `grammY`
- локальная `SQLite`-база для чатов и сообщений
- event log сообщений с sender metadata и `reply_to`
- нейтральные assistant instructions из [`config/assistant-instructions.md`](./config/assistant-instructions.md)
- командные режимы только для `/explain`, `/summarize` и `/decide`
- обычный `@mention` и обычный private text не запускают LLM
- короткий local-context window с отдельными лимитами под каждый intent
- свои bot messages хранятся для audit/logging, но не попадают в prompt context
- сообщения других ботов сохраняются и могут быть reply-якорем для `/explain`
- Telegram typing indicators и короткая bounded задержка ответа
- prompt hardening для transcript и structured logs
- один OpenAI-compatible LLM-клиент для генерации реплик
- `Vitest`-тесты, `TypeScript` typecheck и сборка
- `GitHub Actions` `CI` на `push` и `pull_request`
- автодеплой Docker image из `GHCR` на VPS после `push` в `main`

### Команды

- `/explain` - объяснить сообщение, на которое сделан reply; в v1 можно опираться на общие знания модели, но не на live internet.
- `/summarize` - кратко суммировать только recent human chat messages; без внешних фактов, оценок и интернета.
- `/decide` - оценить текущий спор в чате и сказать, кто ближе, прав, частично прав или что контекста недостаточно; без внешних фактов в v1.

В v1 намеренно нет idle summary, participant memory, aliases, social-QA, самостоятельных interjections, per-chat overrides и фоновых LLM jobs.

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

`.env.example` настроен под OpenAI-compatible провайдера. Если вы хотите использовать другого провайдера или модель, после копирования файла переопределите как минимум `LLM_BASE_URL` и `LLM_REPLY_MODEL`.

3. Проверьте или отредактируйте базовые assistant instructions в [`config/assistant-instructions.md`](./config/assistant-instructions.md).

4. Если это первичная установка или после изменения схемы, подготовьте SQLite-схему.

```bash
npm run migrate
```

5. Запустите бота в режиме разработки.

```bash
npm run dev
```

## Основные переменные окружения

- `TELEGRAM_BOT_TOKEN` или `BOT_TOKEN`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_REPLY_MODEL`
- `LLM_REPLY_TEMPERATURE`
- `LLM_TIMEOUT_MS`
- `LLM_MAX_RETRIES`
- `LOG_LLM_TEXT`
- `EXPLAIN_CONTEXT_LIMIT`
- `SUMMARIZE_CONTEXT_LIMIT`
- `DECIDE_CONTEXT_LIMIT`
- `REPLY_MIN_TYPING_MS`
- `REPLY_MAX_TYPING_MS`
- `REPLY_TYPING_REFRESH_MS`
- `SQLITE_PATH`
- `ASSISTANT_INSTRUCTIONS_FILE`

## Логи

По умолчанию бот пишет компактные multiline-логи для чтения глазами в `docker compose logs`.
Если нужно диагностировать обращения к LLM, явно включите `LOG_LLM_TEXT=true`: появятся события `llm.reply.request/response` с моделью, температурой, оценкой токенов, размерами текста и коротким однострочным preview ответа. Значение `LOG_LLM_TEXT=false` оставляет trace выключенным. Полный prompt и полный response в логи не пишутся.

Цвет можно принудительно включить через `FORCE_COLOR=1`; отключить через стандартный `NO_COLOR=1`.

Смотреть логи локального контейнера:

```bash
docker compose logs bot --tail=100 -f
```

Если нужно видеть LLM trace, включите это в `.env`, перезапустите контейнер и откройте логи:

```bash
LOG_LLM_TEXT=true
FORCE_COLOR=1
docker compose up -d
docker compose logs bot --tail=200 -f
```

## Проверки

- `npm run migrate` (только при первичной установке или изменении схемы)
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run eval:intents` - прогон intent-eval fixture набора; результаты пишутся в gitignored `.eval-runs/`

## Структура

- `src/domain` — правила ответа
- `src/storage` — `SQLite`, чаты и сообщения
- `src/llm` — prompt helpers и reply generation
- `src/transport` — нормализация входящих сообщений Telegram
- `docs/architecture.md` — архитектура и потоки данных
- `docs/development.md` — локальная разработка и CI
- `docs/backlog/ideas.md` — идеи на следующие версии
- `docs/backlog/big-features.md` — крупные future-stage подсистемы

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

Провайдер настраивается через `LLM_*`. Старые `QWEN_*` переменные окружения временно продолжают работать как алиасы. Но `LLM_*` и `QWEN_*` нельзя смешивать в effective runtime environment, независимо от того, приходят ли они из `.env`, shell exports или других источников: миграция должна быть целиком в одном namespace.

## Следующие версии

Идеи для развития вынесены в [`docs/backlog/ideas.md`](./docs/backlog/ideas.md).
