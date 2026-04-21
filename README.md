# Telegram Chat Assistant

Минимальное v1-ядро Telegram chat assistant на `Node.js + TypeScript + grammY + SQLite` с OpenAI-compatible LLM слоем.

## Что уже есть

- long polling через `grammY`
- локальная `SQLite`-база для чатов и сообщений
- event log сообщений с sender metadata и `reply_to`
- нейтральные assistant instructions из [`llm/assistant/base.md`](./llm/assistant/base.md)
- командные режимы только для `/explain`, `/summarize`, `/decide`, `/read` и `/answer`
- обычный `@mention` и обычный private text не запускают LLM
- короткий local-context window с отдельными лимитами под каждый intent
- свои bot messages хранятся для audit/logging, но не попадают в prompt context
- сообщения других ботов сохраняются и могут быть reply-якорем для `/explain` и `/answer`
- Telegram typing indicators и короткая bounded задержка ответа
- Telegram HTML formatting для структурированных ответов с safe allowlist постобработкой
- prompt hardening для transcript и structured logs
- один OpenAI-compatible LLM-клиент для генерации реплик
- `Vitest`-тесты, `TypeScript` typecheck и сборка
- `GitHub Actions` `CI` на `push` и `pull_request`
- автодеплой Docker image из `GHCR` на VPS после `push` в `main`
- Telegram-оповещение об успешном продакшн-деплое с LLM-сжатым списком пользовательских изменений

### Команды

- `/explain` - объяснить сообщение, на которое сделан reply; бот считает replied-to message основным, использует nearby context только для интерпретации, и при включенном lookup может автоматически заземлять внешние сущности/факты через Tavily.
- `/summarize` - кратко суммировать только recent human chat messages; без внешних фактов, оценок и интернета.
- `/decide` - оценить текущий спор в чате; при включенном lookup бот сначала планирует, нужен ли интернет для entity grounding, fact-check, freshness или link understanding, но вкусовой спор не превращает в объективный факт.
- `/read` - лениво распознать replied-to медиа без интерпретации. В v1 поддержаны `photo`, image `document`, `voice`, `audio` и Telegram `video_note`: картинки идут через Cloudflare Workers AI, аудио и кружочки через Gladia, а финальный ответ форматирует `LLM_REPLY_MODEL`.
- `/answer` - напрямую ответить на replied-to сообщение; при включенном lookup бот может заземлять внешние сущности, факты, свежесть или ссылки через Tavily.

В v1 намеренно нет idle summary, participant memory, aliases, social-QA, самостоятельных interjections, per-chat overrides и фоновых LLM jobs.

## Требования

- Node.js `20` or `22` LTS
- npm `11+`
- Telegram bot token
- LLM API key
- Tavily API key for default web grounding

## Локальный запуск

1. Установите зависимости.

```bash
npm install
```

2. Создайте локальный `.env` на основе примера.

```bash
cp .env.example .env
```

`.env.example` настроен под DeepSeek через OpenAI-compatible API. Если вы хотите использовать другого провайдера или модель, после копирования файла переопределите как минимум `LLM_BASE_URL`, `LLM_REPLY_MODEL` и при необходимости `LLM_PLANNER_MODEL`.
Lookup включен по умолчанию и использует Tavily; для старта задайте `TAVILY_API_KEY` или явно отключите lookup через `LOOKUP_ENABLED=false`.
`/read` по умолчанию выключен: для распознавания медиа нужно явно включить `MEDIA_ANALYSIS_ENABLED=true` и задать `GLADIA_API_KEY`, `CLOUDFLARE_AI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`.

3. Проверьте или отредактируйте базовые assistant instructions в [`llm/assistant/base.md`](./llm/assistant/base.md).

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
- `LLM_PLANNER_MODEL`
- `TAVILY_API_KEY`
- `MEDIA_ANALYSIS_ENABLED`
- `READ_CONTEXT_LIMIT`
- `GLADIA_API_KEY`
- `CLOUDFLARE_AI_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `LOG_LLM_TEXT`
- `EXPLAIN_CONTEXT_LIMIT`
- `SUMMARIZE_CONTEXT_LIMIT`
- `DECIDE_CONTEXT_LIMIT`
- `DEPLOY_NOTIFY_CHAT_ID`
- `SQLITE_PATH`

Шумные runtime-твики вроде LLM timeout/retries, typing delay, log level/color, lookup limits, media providers, file-size limit и retention имеют кодовые дефолты в [`src/config/env.ts`](./src/config/env.ts). Их можно переопределить через окружение точечно, если они остались в схеме, но в `.env.example` они намеренно не лежат.

## Логи

По умолчанию бот пишет компактные multiline-логи для чтения глазами в `docker compose logs`.
Если нужно диагностировать обращения к LLM, явно включите `LOG_LLM_TEXT=true`: появятся события `llm.reply.request/response` с моделью, температурой, оценкой токенов, размерами текста и коротким однострочным preview ответа. Значение `LOG_LLM_TEXT=false` оставляет trace выключенным. Полный prompt и полный response в логи не пишутся.
`LOG_LEVEL=info` оставляет только старт, предупреждения и ошибки. Для подробных входящих update/decision/reply lifecycle, включая завершение команд, включите `LOG_LEVEL=debug`.
`LOG_COLOR=true` добавляет ANSI-цвета в консольные логи; `NO_COLOR=1` отключает цвета принудительно.

Цвет также можно принудительно включить через стандартный `FORCE_COLOR=1`.

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
- `npm run eval:intents` - прогон всего intent-eval fixture набора; результаты пишутся в gitignored `.eval-runs/`
- `npm run eval:intents -- --id=decide-laptop-value-dispute` - прогон одного fixture
- `npm run eval:intents -- --intent=summarize` - прогон всех fixtures одного intent

## Структура

- `src/domain` — правила ответа
- `src/storage` — `SQLite`, чаты, сообщения и media artifact cache
- `llm` — статические prompt-файлы для assistant, reply modes, planner и deploy announcements
- `src/llm` — сборка prompt context, LLM-клиент и reply generation
- `src/media` — Gladia STT, Cloudflare Vision, Telegram media metadata/download helpers
- `src/app/telegram-html.ts` — Telegram-safe HTML formatting для исходящих ответов
- `src/transport` — нормализация входящих сообщений Telegram
- `docs/architecture.md` — архитектура и потоки данных
- `docs/development.md` — локальная разработка и CI
- `docs/backlog/ideas.md` — идеи на следующие версии
- `docs/backlog/big-features.md` — крупные future-stage подсистемы

## Docker Deployment

Продакшн-деплой использует готовый Docker image из `GHCR`, а не собирает приложение на сервере.

- GitHub Actions после `push` в `main` прогоняет `typecheck`, `test` и `build`
- затем генерирует deploy metadata со списком вошедших commit messages и публикует image в `ghcr.io`
- после этого workflow по `SSH` обновляет deploy-артефакты на VPS и делает `docker compose pull && docker compose up -d`

`SQLite` не хранится внутри контейнера. Файл базы лежит на VPS в bind mount-папке `./data`, которая на сервере должна находиться рядом с `compose.yml`, например в `/opt/test-chatbot/data/bot.sqlite`.
Распознавание медиа в production тоже по умолчанию выключено: после копирования `deploy/.env.server.example` нужно вручную поставить `MEDIA_ANALYSIS_ENABLED=true`, если на сервере должен работать `/read`.

Deploy metadata хранится рядом с базой в `/opt/test-chatbot/data/deploy-metadata.json` и видна контейнеру как `/app/data/deploy-metadata.json`. На старте бот сравнивает metadata `sha` с `app_state.last_announced_deploy_sha` в SQLite; если sha новый, `LLM_REPLY_MODEL` форматирует короткое русское Telegram HTML-оповещение, бот отправляет его в `DEPLOY_NOTIFY_CHAT_ID`, и только после успешной отправки сохраняет sha.

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

Lookup-backed `/explain`, `/decide` и `/answer` уже подведены к current contract через planner/lookup scaffolding. `/read` реализует lazy media intake только по explicit reply command, кэширует распознанные artifacts в SQLite и удаляет временные файлы после provider call. Следующие улучшения вынесены в [`docs/backlog/ideas.md`](./docs/backlog/ideas.md).
