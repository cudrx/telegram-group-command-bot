# Telegram Chat Assistant

Telegram-бот на `Node.js`, `TypeScript`, `grammY` и `SQLite`.

Бот в основном работает от явных команд, хранит журнал сообщений, умеет обращаться к OpenAI-compatible LLM, при необходимости использует поиск через Tavily, кэширует результаты распознавания медиа и озвучивает ответы через Yandex SpeechKit.

## Возможности

- Получение обновлений из Telegram через long polling в `grammY`.
- Проверка доступа: рабочая группа задается через `TELEGRAM_CHAT_ID`, режим администратора в личке — через `TELEGRAM_ADMIN_ID`, link-only пользователи для лички — через `TELEGRAM_LINK_USER_IDS`.
- SQLite хранит чаты, сообщения, данные отправителей, reply-связи, отметки редактирования, артефакты медиа, историю отправленных мемов и небольшой `app_state`.
- Команды: `/summarize`, `/decide`, `/answer`, `/translate`, `/read`, `/meme`, `/publish`.
- Поиск для `/decide` и `/answer` включается только при наличии `TAVILY_API_KEY`.
- Reply prompt для LLM получает текущие дату и время Москвы простым текстом, чтобы ответы корректно разрешали “сегодня”, “завтра” и “вчера”.
- Автоматическое распознавание поддержанных медиа при наличии ключей провайдеров:
  `GLADIA_API_KEY`, `CLOUDFLARE_AI_API_KEY` + `CLOUDFLARE_ACCOUNT_ID`, `OCR_SPACE_API_KEY`.
- `/read` озвучивает текст сообщения, на которое сделали reply, при наличии `YANDEX_SPEECHKIT_API_KEY`.
- `/translate` переводит на русский текст, подпись, OCR, описание картинки или расшифровку аудио из сообщения, на которое сделали reply.
- `/meme` берет случайный свежий пост из Reddit top-week по hardcoded пулу сабреддитов, отправляет картинку или видео с оригинальным title без reply на команду и сохраняет Telegram media metadata для будущего контекста. Reddit NSFW/spoiler posts отправляются с Telegram spoiler flag.
- Reddit post-ссылки с поддержанными image/gallery/video media, Instagram Reel-ссылки и YouTube Shorts-ссылки в обычных сообщениях рабочего чата, лички администратора и личек link-only пользователей разворачиваются автоматически: бот скачивает media во временные файлы, отправляет без reply на исходное сообщение, затем пытается удалить сообщение со ссылкой. Reddit captions используют title, `r/<subreddit>` и кликабельные апвоуты; Reels/Shorts captions используют только `<source>: <nickname> · likes: <linked count>`. Reddit NSFW/spoiler media отправляется с Telegram spoiler flag.
- `/publish` в личке администратора копирует reply-сообщение или последнее сообщение перед командой в рабочий чат без attribution исходного автора.
- Локальные подсказки и fallback-сообщения бота отправляются только текстом, даже если исходящая озвучка включена.
- Безопасное HTML-форматирование ответов для Telegram.
- Оповещение о продакшн-деплое, дедуплицированное через SQLite.

Обычное упоминание бота и обычный текст в личке не запускают LLM. Исключение — явная Reddit post-ссылка с поддержанным image/gallery/video media, Instagram Reel-ссылка или YouTube Shorts-ссылка, которую бот обрабатывает локально без LLM. Link-only пользователи из `TELEGRAM_LINK_USER_IDS` в личке могут отправлять только поддержанные ссылки; их команды игнорируются. В проекте нет самостоятельных вмешательств, памяти о пользователях, профилей, алиасов, настроек по чатам и фоновых LLM-задач.
Если пользователь редактирует уже сохраненное входящее сообщение, бот обновляет его текст и `edited_at` в SQLite для будущего контекста, но не пересчитывает уже отправленные ответы.

## Команды

- `/summarize` — кратко суммировать последние сообщения людей в чате.
- `/decide` — оценить текущий спор; при настроенном поиске может проверять внешние факты через Tavily.
- `/answer` — ответить на reply-сообщение или последнее сообщение перед командой.
- `/translate` — перевести на русский содержимое сообщения, на которое пользователь сделал reply командой.
- `/read` — озвучить текстовое сообщение, на которое сделали reply; текст после команды игнорируется.
- `/meme` — отправить случайный неповторявшийся за последние 14 дней image/gallery/video мем из Reddit.
- `/publish` — в личке администратора скопировать reply-сообщение или последнее сообщение перед командой в рабочий чат; альбомы копируются целиком, если все элементы альбома были сохранены ботом.

## Требования

- Node.js `22` LTS
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
- `TELEGRAM_LINK_USER_IDS`
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
- `REDDIT_COOKIES_PATH`
- `INSTAGRAM_COOKIES_PATH`
- `YOUTUBE_COOKIES_PATH`

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

Для Reddit video, Instagram Reels и YouTube Shorts standalone `yt-dlp` zipapp хранится на хосте в `data/bin/yt-dlp` и пробрасывается в контейнер через compose как `/usr/local/bin/yt-dlp`. Runtime image содержит `python3`, `ffmpeg` и Node.js 22, чтобы `yt-dlp` мог склеивать video/audio tracks в mp4 со звуком и решать YouTube EJS challenges через `--js-runtimes node`. Любое Reddit-hosted video, Instagram Reel и YouTube Short скачивается через `yt-dlp` сразу; Reddit `fallback_url` и похожие прямые MP4 URL можно использовать только как metadata/признак video-поста, но не как download path. Для Reels `yt-dlp` предпочитает HLS/m3u8 video + m4a audio merge, чтобы мобильные Telegram-клиенты сохраняли геометрию видео, без отдельного перекодирования. `/meme` Reddit listing и Reddit direct links используют `REDDIT_COOKIES_PATH`, Reels используют `INSTAGRAM_COOKIES_PATH`, Shorts используют `YOUTUBE_COOKIES_PATH`; если пути не заданы, defaults строятся как `reddit-cookies.txt`, `instagram-cookies.txt` и `youtube-cookies.txt` рядом с SQLite.

## Документация

- `docs/README.md` — карта Markdown-файлов.
- `docs/architecture.md` — архитектура, инварианты и основные потоки.
- `docs/development.md` — локальная разработка, проверки, CI/CD и заметки по продакшну.
