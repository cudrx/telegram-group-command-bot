# Telegram Chat Assistant

Минимальное v1-ядро Telegram chat assistant на `Node.js + TypeScript + grammY + SQLite` с OpenAI-compatible LLM слоем.

## Что уже есть

- long polling через `grammY`
- локальная `SQLite`-база для чатов и сообщений
- event log сообщений с sender metadata и `reply_to`
- нейтральные assistant instructions из [`llm/assistant/base.md`](./llm/assistant/base.md)
- командные режимы для `/summarize`, `/decide`, `/answer` и admin-only `/weekly`
- бот принимает сообщения только из `TELEGRAM_CHAT_ID` и только от `TELEGRAM_ADMIN_ID` в `private`
- обычный `@mention` и обычный private text не запускают LLM
- короткий local-context window с отдельными лимитами под каждый intent
- свои bot messages хранятся для audit/logging, но не попадают в prompt context
- сообщения других ботов сохраняются и могут быть reply-якорем для `/answer`
- Telegram typing indicators и короткая bounded задержка ответа
- Telegram HTML formatting для структурированных ответов с safe allowlist постобработкой
- prompt hardening для transcript и structured logs
- один OpenAI-compatible LLM-клиент для генерации реплик
- `Vitest`-тесты, `TypeScript` typecheck и сборка
- `GitHub Actions` `CI` на `push` и `pull_request`
- автодеплой Docker image из `GHCR` на VPS после `push` в `main`
- Telegram-оповещение об успешном продакшн-деплое с LLM-сжатым списком пользовательских изменений

### Команды

- `/summarize` - кратко суммировать только recent human chat messages; без внешних фактов, оценок и интернета.
- `/decide` - оценить текущий спор в чате; при включенном lookup бот сначала планирует, нужен ли интернет для entity grounding, fact-check, freshness или link understanding, но вкусовой спор не превращает в объективный факт.
- `/answer` - напрямую ответить на replied-to сообщение; при включенном lookup бот может заземлять внешние сущности, факты, свежесть или ссылки через Tavily.
- `/weekly` - работает только в private chat от `TELEGRAM_ADMIN_ID`; читает последние семь дней из `TELEGRAM_CHAT_ID`, использует только уже сохраненные media artifacts, генерирует recap и публикует его прямо в configured group chat без private confirmation.

Поддержанные входящие медиа (`photo`, image `document`, `voice`, `audio`, Telegram `video_note`) обрабатываются автоматически в авторизованных чатах, когда настроены соответствующие provider keys. Артефакты сохраняются в SQLite и переиспользуются в `/answer`, `/decide`, `/summarize` и `/weekly`. Weekly recap никогда не запускает новое распознавание медиа: если cached artifact отсутствует, recap строится по тексту и metadata.

В v1 намеренно нет idle summary, participant memory, aliases, social-QA, самостоятельных interjections, per-chat overrides и фоновых LLM jobs.

## Требования

- Node.js `20` or `22` LTS
- npm `11+`
- Telegram bot token
- LLM API key
- Tavily API key, if live lookup should be available

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
Lookup использует Tavily, когда задан `TAVILY_API_KEY`; без ключа lookup provider не создается.
Автоматическое распознавание медиа запускается по наличию provider keys: `GLADIA_API_KEY` для аудио, `CLOUDFLARE_AI_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` для vision и `OCR_SPACE_API_KEY` для OCR.

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
- `READ_CONTEXT_LIMIT`
- `GLADIA_API_KEY`
- `CLOUDFLARE_AI_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `OCR_SPACE_API_KEY`
- `LOG_LLM_TEXT`
- `SUMMARIZE_CONTEXT_LIMIT`
- `DECIDE_CONTEXT_LIMIT`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_ADMIN_ID`
- `SQLITE_PATH`

Шумные runtime-твики вроде LLM timeout/retries, typing delay, log level/color, lookup limits, media providers, file-size limit и retention имеют кодовые дефолты в [`src/config/env/`](./src/config/env/). Их можно переопределить через окружение точечно, если они остались в схеме, но в `.env.example` они намеренно не лежат.

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
- `SQLITE_PATH=... TELEGRAM_CHAT_ID=... npm exec tsx scripts/weekly-smoke.ts` - локально напечатать weekly dataset без Telegram и LLM calls

## Структура

- `src/domain` — правила ответа
- `src/database` — `SQLite`, чаты, сообщения и media artifact cache
- `src/app/weekly` — загрузка семидневного среза, cached media enrichment, event selection и weekly dataset formatting
- `llm` — статические prompt-файлы для assistant, reply modes, planner и deploy announcements
- `src/llm` — сборка prompt context, LLM-клиент и reply generation
- `src/media` — Gladia STT, Cloudflare Vision, Telegram media metadata/download helpers
- `src/app/telegram-html.ts` — Telegram-safe HTML formatting для исходящих ответов
- `src/transport` — нормализация входящих сообщений Telegram
- `docs/architecture.md` — архитектура и потоки данных
- `docs/development.md` — локальная разработка и CI
- `docs/superpowers/plans/` — свежие design docs и implementation plans

## Docker Deployment

Продакшн-деплой использует готовый Docker image из `GHCR`, а не собирает приложение на сервере.

- GitHub Actions после `push` в `main` прогоняет `typecheck`, `test` и `build`
- затем генерирует deploy metadata со списком вошедших commit messages и публикует image в `ghcr.io`
- после этого workflow по `SSH` обновляет deploy-артефакты на VPS и делает `docker compose pull && docker compose up -d`

`SQLite` не хранится внутри контейнера. Файл базы лежит на VPS в bind mount-папке `./data`, которая на сервере должна находиться рядом с `compose.yml`, например в `/opt/test-chatbot/data/bot.sqlite`.
После копирования `deploy/.env.server.example` проверьте реальные значения секретов, `TELEGRAM_CHAT_ID` и `TELEGRAM_ADMIN_ID`.

Deploy metadata хранится рядом с базой в `/opt/test-chatbot/data/deploy-metadata.json` и видна контейнеру как `/app/data/deploy-metadata.json`. На старте бот сравнивает metadata `sha` с `app_state.last_announced_deploy_sha` в SQLite; если sha новый, `LLM_REPLY_MODEL` форматирует короткое русское Telegram HTML-оповещение, бот отправляет его в `TELEGRAM_CHAT_ID`, и только после успешной отправки сохраняет sha.

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

Lookup-backed `/decide` и `/answer` уже подведены к current contract через planner/lookup scaffolding. Автоматический media intake кэширует распознанные artifacts в SQLite, удаляет временные файлы после provider call и добавляет успешные summaries в relevant reply context. Свежие design docs и implementation plans лежат в [`docs/superpowers/plans/`](./docs/superpowers/plans/).
