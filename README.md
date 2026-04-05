# Character Telegram Bot

Минимальная рабочая основа для Telegram-бота-персонажа на `Node.js + TypeScript + grammY + SQLite + Qwen`.

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
- `Qwen`-клиент для генерации реплик и summary с timeout/retry
- `Vitest`-тесты, `TypeScript` typecheck и сборка
- `GitHub Actions` `CI` на `push` в `main`

## Требования

- Node.js `20` or `22` LTS
- npm `11+`
- Telegram bot token
- Qwen API key

## Локальный запуск

1. Установите зависимости.

```bash
npm install
```

2. Создайте локальный `.env` на основе примера.

```bash
cp .env.example .env
```

3. Проверьте или отредактируйте базовую persona в [`config/persona.md`](./config/persona.md).

4. Если нужен отдельный образ для конкретного чата, создайте файл `config/personas/<chat_id>.md`.
   Бот автоматически добавит его поверх базовой persona только в этом чате.

5. Подготовьте SQLite-схему.

```bash
npm run migrate
```

6. Запустите бота в режиме разработки.

```bash
npm run dev
```

## Основные переменные окружения

- `TELEGRAM_BOT_TOKEN` или `BOT_TOKEN`
- `QWEN_API_KEY`
- `QWEN_BASE_URL`
- `QWEN_REPLY_MODEL`
- `QWEN_SUMMARY_MODEL`
- `QWEN_TIMEOUT_MS`
- `QWEN_MAX_RETRIES`
- `INTERJECT_PROBABILITY`
- `INTERJECT_COOLDOWN_MINUTES`
- `CHAT_IDLE_MINUTES`
- `MIN_MESSAGES_FOR_SUMMARY`
- `MESSAGE_CONTEXT_LIMIT`
- `MESSAGE_RETENTION_DAYS`
- `SQLITE_PATH`
- `PERSONA_FILE`

## Проверки

- `npm run migrate`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Структура

- `src/domain` — правила ответа и summary
- `src/storage` — `SQLite` и доступ к данным
- `src/llm` — prompt helpers и `Qwen`-клиент
- `src/transport` — нормализация входящих сообщений Telegram
- `docs/architecture.md` — архитектура и потоки данных
- `docs/development.md` — локальная разработка и CI
- `docs/backlog/ideas.md` — идеи на следующие версии

## Следующие версии

Идеи для развития вынесены в [`docs/backlog/ideas.md`](./docs/backlog/ideas.md).
