# Character Telegram Bot

Минимальная рабочая основа для Telegram-бота-персонажа на `Node.js + TypeScript + grammY + SQLite` с DeepSeek-compatible LLM слоем.

## Что уже есть

- long polling через `grammY`
- локальная `SQLite`-база для чатов, сообщений и профилей участников
- chat-scoped память по участникам: `core` / `durable` / `volatile` факты
- chat-local self-memory для самого персонажа поверх глобальной persona
- per-chat persona overrides через `config/personas/<chat_id>.md`
- дедупликация, supersede конфликтующих фактов и TTL для временной памяти
- глобальная persona-основа из [`config/persona.md`](./config/persona.md)
- доменная логика ответа: `mention` / `reply` / редкое случайное вмешательство
- фоновый idle-summary после затихания чата
- единая per-chat координация reply и summary без overlap `LLM`-job'ов
- prompt hardening для transcript и structured JSON logs
- generic LLM-клиент для генерации реплик и summary с timeout/retry
- `Vitest`-тесты, `TypeScript` typecheck и сборка
- `GitHub Actions` `CI` на `push` в `main`

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

`.env.example` настроен под DeepSeek по умолчанию. Если вы хотите использовать другого OpenAI-compatible провайдера, после копирования файла переопределите как минимум `LLM_BASE_URL`, `LLM_REPLY_MODEL` и `LLM_SUMMARY_MODEL`.
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
- `INTERJECT_PROBABILITY`
- `INTERJECT_COOLDOWN_MINUTES`
- `CHAT_IDLE_MINUTES`
- `MIN_MESSAGES_FOR_SUMMARY`
- `MESSAGE_CONTEXT_LIMIT`
- `MESSAGE_RETENTION_DAYS`
- `SQLITE_PATH`
- `PERSONA_FILE`

## Проверки

- `npm run migrate` (только при первичной установке или изменении схемы)
- `npm run typecheck`
- `npm test`
- `npm run build`

## Структура

- `src/domain` — правила ответа и summary
- `src/storage` — `SQLite` и доступ к данным
- `src/llm` — prompt helpers и OpenAI-compatible LLM layer
- `src/transport` — нормализация входящих сообщений Telegram
- `docs/architecture.md` — архитектура и потоки данных
- `docs/development.md` — локальная разработка и CI
- `docs/backlog/ideas.md` — идеи на следующие версии

## Migration Note

Переход на `LLM_*` идет без жесткого breakage: старые `QWEN_*` переменные окружения временно продолжают работать как алиасы. Но `LLM_*` и `QWEN_*` нельзя смешивать в effective runtime environment, независимо от того, приходят ли они из `.env`, shell exports или других источников: миграция должна быть целиком в одном namespace, потому что mixed namespaces parser отклоняет.

## Следующие версии

Идеи для развития вынесены в [`docs/backlog/ideas.md`](./docs/backlog/ideas.md).
