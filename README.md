# Telegram Chat Assistant

Telegram-бот на `Node.js`, `TypeScript`, `grammY` и `SQLite`.

Бот в основном работает от явных команд, хранит журнал сообщений, умеет обращаться к OpenAI-compatible LLM, при необходимости использует поиск через Tavily, кэширует результаты распознавания медиа и озвучивает ответы через Yandex SpeechKit.

## Возможности

- Получение обновлений из Telegram через long polling в `grammY`.
- Проверка доступа: рабочая группа задается через `TELEGRAM_CHAT_ID`, режим администратора в личке — через `TELEGRAM_ADMIN_ID`.
- SQLite хранит чаты, сообщения, данные отправителей, reply-связи, отметки редактирования, артефакты медиа, недельный кэш news-постов и небольшой `app_state`.
- Команды: `/summarize`, `/decide`, `/answer`, `/translate`, `/read`, `/meme`, `/publish`, `/news`.
- Поиск для `/decide` и `/answer` включается только при наличии `TAVILY_API_KEY`.
- Reply prompt для LLM получает текущие дату и время Москвы простым текстом, чтобы ответы корректно разрешали “сегодня”, “завтра” и “вчера”.
- Автоматическое распознавание поддержанных медиа при наличии ключей провайдеров:
  `GLADIA_API_KEY`, `CLOUDFLARE_AI_API_KEY` + `CLOUDFLARE_ACCOUNT_ID`, `OCR_SPACE_API_KEY`.
- `/read` озвучивает текст сообщения, на которое сделали reply, при наличии `YANDEX_SPEECHKIT_API_KEY`.
- `/translate` переводит на русский текст, подпись, OCR, описание картинки или расшифровку аудио из сообщения, на которое сделали reply.
- `/meme` берет случайный свежий image-мем через `meme-api.com` по hardcoded пулу сабреддитов, отправляет картинку с оригинальным title и сохраняет Telegram photo metadata для будущего контекста.
- Reddit post-ссылки с Reddit-hosted video в рабочем чате и личке администратора разворачиваются автоматически: бот скачивает видео во временный файл, отправляет его с title, `r/<subreddit>` и апвоутами, затем пытается удалить исходное сообщение со ссылкой.
- `/publish` в личке администратора копирует reply-сообщение или последнее сообщение перед командой в рабочий чат без attribution исходного автора.
- `/news` в личке администратора собирает text-only посты из configured публичных `t.me/s/<channel>` источников, кэширует их на неделю и отправляет LLM аналитический дайджест.
- Локальные подсказки и fallback-сообщения бота отправляются только текстом, даже если исходящая озвучка включена.
- Безопасное HTML-форматирование ответов для Telegram.
- Оповещение о продакшн-деплое, дедуплицированное через SQLite.

Обычное упоминание бота и обычный текст в личке не запускают LLM. Исключение — явная Reddit video post-ссылка, которую бот обрабатывает локально без LLM. В проекте нет самостоятельных вмешательств, памяти о пользователях, профилей, алиасов, настроек по чатам и фоновых LLM-задач.
Если пользователь редактирует уже сохраненное входящее сообщение, бот обновляет его текст и `edited_at` в SQLite для будущего контекста, но не пересчитывает уже отправленные ответы.

## Команды

- `/summarize` — кратко суммировать последние сообщения людей в чате.
- `/decide` — оценить текущий спор; при настроенном поиске может проверять внешние факты через Tavily.
- `/answer` — ответить на reply-сообщение или последнее сообщение перед командой.
- `/translate` — перевести на русский содержимое сообщения, на которое пользователь сделал reply командой.
- `/read` — озвучить текстовое сообщение, на которое сделали reply; текст после команды игнорируется.
- `/meme` — отправить случайный неповторявшийся за последние 14 дней image-мем из Reddit wrapper.
- `/publish` — в личке администратора скопировать reply-сообщение или последнее сообщение перед командой в рабочий чат; альбомы копируются целиком, если все элементы альбома были сохранены ботом.
- `/news` — в личке администратора обновить публичные Telegram news-источники и получить LLM-анализ; в рабочем чате команда недоступна.

## Требования

- Node.js `20` или `22` LTS
- npm `11+`
- токен Telegram-бота
- ключ OpenAI-compatible LLM API
Ключи дополнительных провайдеров нужны только для соответствующих возможностей.

## Локальный запуск

1. Установить зависимости:

```bash
npm install
```

2. Создать `.env`:

```bash
cp .env.example .env
```

Замените обязательные плейсхолдеры:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_ADMIN_ID`
- `LLM_API_KEY`

Ключи дополнительных провайдеров в `.env.example` тоже выглядят как плейсхолдеры. Если провайдер не нужен, удалите или закомментируйте его строку; если нужен — замените на реальный ключ. Проверка окружения специально не дает стартовать с `your-*` значениями.

3. При необходимости поменять провайдера или модель LLM:

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_REPLY_MODEL=deepseek-v4-flash
LLM_PLANNER_MODEL=deepseek-v4-flash
```

4. Создать или обновить SQLite-схему:

```bash
npm run migrate
```

5. Запустить режим разработки:

```bash
npm run dev
```

## Основные переменные окружения

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_ADMIN_ID`
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_REPLY_MODEL`
- `LLM_PLANNER_MODEL`
- `TAVILY_API_KEY`
- `GLADIA_API_KEY`
- `OCR_SPACE_API_KEY`
- `CLOUDFLARE_AI_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `YANDEX_SPEECHKIT_API_KEY`
- `LOG_LEVEL`
- `LOG_COLOR`
- `LOG_LLM_TEXT`
- `SQLITE_PATH`

Остальные настройки времени выполнения разделены на два слоя: deploy-specific
значения и секреты описаны в `src/config/env/`, а несекретные defaults поведения
и провайдеров сгруппированы в `src/config/runtime/`. Переопределять через
окружение можно только значения, добавленные в env-схему.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Дополнительно:

```bash
npm run eval:intents
npm run eval:intents -- --id=decide-laptop-value-dispute
npm run eval:intents -- --intent=summarize
npm run eval:news
```

Отчеты eval пишутся в `.eval-runs/`; папка игнорируется Git.

## Структура

- `src/index.ts` — точка входа процесса.
- `src/app.ts` — сборка приложения.
- `src/app/` — оркестрация, отправка сообщений в Telegram, HTML-форматирование, оповещения о деплое.
- `src/app/actions/` — модульные action-команды, registry команд и action-local helpers.
- `src/app/chat-orchestrator/` — жизненный цикл входящего сообщения, сохранение, media auto-read и запуск action через registry.
- `src/config/env/` — схема окружения, значения по умолчанию и проверки.
- `src/database/` — схема SQLite, миграции, преобразование строк и запросы.
- `src/domain/` — общие доменные типы сообщений, чатов и intent.
- `src/llm/` — сборка prompt, планировщик поиска, OpenAI-compatible клиент.
- `src/media/` — Telegram media download, Gladia, Cloudflare Vision, OCR.space.
- `src/tts/` — подготовка текста к речи, политика озвучки, Yandex SpeechKit.
- `src/transport/` — нормализация сообщений Telegram.
- `llm/` — статические prompt-файлы.
- `scripts/` — миграции, metadata для деплоя и eval-скрипты.
- `docs/` — карта документации, архитектура, руководство по разработке.

## Docker

Локальная smoke-проверка использует корневой `compose.yml`:

```bash
npm run build
docker compose config
docker compose up -d
docker compose ps
docker compose logs bot --tail=100 -f
docker compose down
```

Продакшн-деплой собирается в GitHub Actions, публикует образ в GHCR и на сервере выполняет `docker compose pull` + `docker compose up -d`. SQLite живет в примонтированной папке `data/`, а не внутри контейнера.

Для direct Reddit video fallback образ содержит `yt-dlp` и `ffmpeg`. Если Reddit anonymous JSON возвращает 403, бот использует cookies-файл `reddit-cookies.txt` из той же директории, где лежит SQLite база, например `/app/data/reddit-cookies.txt`.

## Документация

- `docs/README.md` — карта Markdown-файлов.
- `docs/architecture.md` — архитектура, инварианты и основные потоки.
- `docs/development.md` — локальная разработка, проверки, CI/CD и заметки по продакшну.
