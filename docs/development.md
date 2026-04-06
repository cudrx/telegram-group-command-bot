# Development Guide

## Requirements

- `Node.js 20` or `22` LTS
- `npm 11+`
- Telegram bot token
- LLM API key

## Project Files

- [`README.md`](../README.md) — быстрый старт
- [`docs/architecture.md`](./architecture.md) — устройство проекта
- [`docs/backlog/ideas.md`](./backlog/ideas.md) — идеи следующих версий
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

Если используете не DeepSeek, а другой OpenAI-compatible провайдер, после копирования `.env.example` переопределите как минимум `LLM_BASE_URL`, `LLM_REPLY_MODEL` и `LLM_SUMMARY_MODEL`.
Для полного feature parity провайдер также должен поддерживать structured JSON response через `response_format: { type: "json_object" }`, потому что summary-генерация опирается на этот контракт.

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
- `npm start` — запуск собранного `dist/index.js`

## CI

Workflow лежит в [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml).

На `push` в `main` он делает:

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

- автодеплой;
- миграции с версиями;
- интеграционные тесты с реальным Telegram API;
- smoke-тесты с реальным LLM-провайдером.

## Memory Model

Память об участниках хранится строго внутри каждого чата.

- `core` — почти неизменные факты;
- `durable` — долгоживущие, но потенциально изменяемые факты;
- `volatile` — временные факты с TTL;
- conflicting `single` memories supersede предыдущие значения;
- `profile_summary_text` теперь служит кэшем-выжимкой поверх structured memories.
- у бота есть отдельная chat-local self-memory поверх `config/persona.md`; она хранит только эволюционирующие локальные штуки, но не переписывает core persona.
- при наличии `config/personas/<chat_id>.md` этот файл добавляется поверх базовой persona только для соответствующего чата.
- старые `messages` можно автоматически подчищать через `MESSAGE_RETENTION_DAYS`; удаляются только сообщения, уже покрытые `summary`, а небольшой сырой хвост сохраняется.
