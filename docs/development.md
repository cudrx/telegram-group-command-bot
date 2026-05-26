# Руководство По Разработке

## Требования

- Node.js `22` LTS
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
- `src/app/actions/` — action-модули команд и command registry.
- `src/llm/current-datetime.ts` — форматирование текущей даты и времени Москвы для reply prompt.
- `src/config/env/` — схема окружения, значения по умолчанию и проверки.
- `src/config/runtime/` — типизированные runtime defaults, сгруппированные по action и provider.
- `scripts/` — миграции, eval-скрипты и metadata для деплоя.

## Окружение

Обязательные переменные:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_ADMIN_ID`
- `TELEGRAM_LINK_USER_IDS` — optional comma-separated Telegram user ids allowed to DM only supported direct media links; their commands are ignored.
- `LLM_API_KEY`
- `REDDIT_COOKIES_PATH` — optional path to Netscape cookies for Reddit listing/direct video requests; defaults to `reddit-cookies.txt` next to SQLite.
- `INSTAGRAM_COOKIES_PATH` — optional path to Netscape cookies for Instagram Reels; defaults to `instagram-cookies.txt` next to SQLite.
- `YOUTUBE_COOKIES_PATH` — optional path to Netscape cookies for YouTube Shorts; defaults to `youtube-cookies.txt` next to SQLite.

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

Runtime-настройки, которые не являются секретами и не требуют deploy-specific
переопределения, лежат в `src/config/runtime/`. Значения там сгруппированы по
сценариям (`actions/answer`, `actions/read`, `actions/meme`) и внешним
провайдерам (`providers/llm`, `providers/media`, `providers/tts`,
`providers/lookup`). Если настройка должна меняться между окружениями,
добавляйте ее в `src/config/env/schema.ts`, а default берите из runtime config.

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

Prompt-контракт reply-моделей включает блок `CURRENT_DATETIME` с текущими датой
и временем Москвы в простом текстовом формате. При изменениях сборки prompt
держите это поле в тестах и intent fixtures, чтобы LLM могла корректно считать
относительные даты.

## Добавление Команды

Новая команда добавляется как action-модуль:

1. Создать `src/app/actions/<name>/index.ts`.
2. Экспортировать `ChatAction` с `intent`, `commands`, `modes` и `handle`.
3. Подключить action в `src/app/actions/index.ts`.
4. Добавить focused tests для registry/action behavior.
5. Если action использует LLM, prompt остается в `llm/`.

Команды только для лички администратора регистрируйте с `modes:
['private_admin']`. Такие команды не должны резолвиться в обычном рабочем чате.

`index.ts` в action-папке должен оставаться входной точкой. Если файл достигает
250+ строк, логику нужно вынести в соседние файлы этой же папки.

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

На `push`, `pull_request` и ручной `workflow_dispatch` выполняются:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`

## Продакшн-Деплой

Workflow деплоя: `.github/workflows/deploy.yml`.

Деплой запускается автоматически на `push` в `main` и вручную через GitHub
Actions `Run workflow`. Серверная папка деплоя не является git-репозиторием:
workflow загружает compose/assets, публикует Docker image в GHCR и на сервере
выполняет pull/up через `deploy/remote-deploy.sh`.

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
- Сначала проверяйте явные `/answer`, `/translate`, `/summarize`, `/decide`, `/read`.
- `/answer` проверяйте как reply и без reply: без reply он отвечает на последнее сообщение перед командой.
- `/translate` и `/read` требуют reply на целевое сообщение.
- `/translate` должен возвращать локальный fallback для уже русского target и переводить на русский нерусские текстовые/media-блоки с заголовками источников.
- Редактирование уже сохраненного сообщения должно обновлять будущий контекст, но не отправлять новый ответ само по себе.
- `/meme` делает внешний запрос к Reddit top-week listing с cookies из `REDDIT_COOKIES_PATH`, выбирает свежий supported image/gallery/video post, отправляет media без reply на команду, скачивает media во временные файлы и должен чистить их после успешной отправки и после ошибок Telegram. Для video-постов также нужны `yt-dlp` и `ffmpeg`. Reddit NSFW/spoiler posts не отбрасываются, но отправляются с Telegram spoiler flag; для gallery spoiler flag должен стоять на каждом элементе.
- Direct Reddit media link smoke: положите standalone `yt-dlp` zipapp в `data/bin/yt-dlp`, настройте `REDDIT_COOKIES_PATH`, отправьте Reddit post URL с image, gallery или `reddit_video` в рабочий чат или личку администратора обычным сообщением без команды. Бот должен отправить `sendPhoto`, `sendMediaGroup` или `sendVideo` без reply на исходное сообщение, с title, subreddit и апвоутами, сохранить post metadata, очистить temp files и попытаться удалить исходное сообщение со ссылкой. Reddit NSFW/spoiler media должны уйти с Telegram spoiler flag; для gallery он должен стоять на всех элементах. В группе для удаления нужны admin-права бота и выключенный BotFather privacy mode, если ссылка отправляется без команды/упоминания.
- Direct Instagram Reels smoke: настройте `INSTAGRAM_COOKIES_PATH`, отправьте `https://www.instagram.com/reel/<shortcode>/` в рабочий чат, личку администратора или личку пользователя из `TELEGRAM_LINK_USER_IDS`. Бот должен скачать Reel через `yt-dlp`, нормализовать mp4 через `ffmpeg`, отправить `sendVideo` без reply, подписать `inst: <nickname> · likes: <linked count>`, очистить temp files и попытаться удалить исходное сообщение.
- Direct YouTube Shorts smoke: настройте `YOUTUBE_COOKIES_PATH`, отправьте `https://youtu.be/<id>`, `https://www.youtube.com/watch?v=<id>` или `https://www.youtube.com/shorts/<id>` в рабочий чат, личку администратора или личку пользователя из `TELEGRAM_LINK_USER_IDS`. Бот должен скачать Short через `yt-dlp`, нормализовать mp4 через `ffmpeg`, отправить `sendVideo` без reply, подписать `yt: <channel> · likes: <linked count>`, очистить temp files и попытаться удалить исходное сообщение.
- YouTube Shorts требуют runtime image с Node.js 22+: `yt-dlp` запускается с `--js-runtimes node`, чтобы решать YouTube EJS challenges.
- Для Reddit video, Instagram Reels и YouTube Shorts не добавляйте прямое скачивание `fallback_url`/MP4 как shortcut или fallback: видео должно сразу идти через общий pipeline `yt-dlp download -> ffmpeg normalize -> sendVideo`, иначе легко отправить mp4 без audio track, с нестабильным aspect ratio или с pixel format, который Telegram показывает криво. Нормализация приводит файл к H.264/AAC MP4, `yuv420p`, `SAR 1:1`, `color_range tv`, удаляет metadata и применяет `+faststart`.
- `/publish` запускайте в личке администратора: проверьте reply, вариант без reply и media album; копия должна появиться в рабочем `TELEGRAM_CHAT_ID` как сообщение бота без attribution исходного автора.
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
