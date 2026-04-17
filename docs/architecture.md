# Architecture

## V0 Scope

Текущая версия проекта намеренно сведена к маленькому explicit-assistant ядру: один процесс с `long polling`, локальная `SQLite`, один нейтральный assistant instruction file и один OpenAI-compatible reply path.

Бот умеет:

- читать текстовые сообщения из Telegram;
- сохранять чаты, входящие сообщения, исходящие сообщения, sender metadata и `reply_to` связи;
- отвечать только на `@mention`;
- строить короткий human-only local context для `mention`;
- генерировать ответ через `generateReply`;
- сохранять исходящее bot-сообщение;
- показывать Telegram typing indicator во время подготовки ответа.

В v0 намеренно отсутствуют:

- autonomous interjections;
- idle summary;
- participant memory;
- participant aliases;
- social-QA;
- per-chat overrides;
- reply-to-bot routing;
- фоновые LLM jobs;
- summary-based retention.

## Product Invariants

- главный источник истины для ответа — event log в `messages`, а не summary или memory;
- бот отвечает только когда его явно дёрнули через `@mention`;
- каждый ответ должен объясняться по логам через `trigger`, `replyToMessageId`, `context` и факт LLM-решения;
- prompt не должен содержать chat summary, participant memory, social-QA bundle или self-memory;
- assistant instructions управляют тоном, а не фактами;
- Telegram typing indicator является app/transport поведением и не запускает model calls.

## Component Map

### `src/transport`

Отвечает за Telegram-специфику:

- получает `Update` через `grammY`;
- нормализует входящее сообщение в локальный `NormalizedMessage`;
- не содержит доменных решений о том, отвечать ли боту.

### `src/domain`

Чистая логика проекта:

- определение прямого триггера ответа (`mention`, `none`);
- решение `reply` / `ignore`.

### `src/storage`

Слой хранения на `SQLite`:

- чаты;
- сообщения с `reply_to` связями;
- sender metadata прямо в `messages`.

### `src/llm`

Изолирует работу с OpenAI-compatible LLM слоем:

- сбор reply prompt;
- генерация ответа assistant-core;
- timeout/retry и логирование LLM input/output при `LOG_LLM_TEXT=true`.

### `src/app`

Координирует приложение:

- принимает нормализованное сообщение;
- сохраняет его в БД;
- решает, должен ли бот отвечать;
- собирает context;
- вызывает OpenAI-compatible reply LLM;
- показывает Telegram typing indicator;
- отправляет ответ в Telegram;
- сохраняет исходящее bot-сообщение.

## Main Flow

1. `grammY` получает новое текстовое сообщение.
2. `normalizeTextMessage` переводит его в локальный `NormalizedMessage`.
3. `DatabaseClient.saveIncomingMessage` сохраняет чат и сообщение.
4. `detectDirectTrigger` и `decideReplyAction` определяют `mention` или `ignore`.
5. Если ответ не нужен, pipeline заканчивается.
6. Если ответ нужен:
   - подтягиваются assistant instructions;
   - строится `ReplyContext`;
   - вызывается reply LLM;
   - Telegram получает best-effort `typing` action и bounded delay;
   - ответ отправляется в Telegram и сохраняется в БД.

## Context Contract

### `mention`

Порядок важности:

1. Current mention message
2. Последние human messages в пределах `MESSAGE_CONTEXT_LIMIT`
3. Assistant instructions

Assistant instructions загружаются отдельно и не смешиваются с per-chat context.

## Database Model

### `chats`

Хранит:

- тип чата;
- title;
- время последнего сообщения;
- время последнего ответа бота.

### `messages`

Хранит:

- текстовые сообщения и ответы бота;
- `reply_to_telegram_message_id`, когда сообщение является ответом;
- sender metadata: `user_id`, username, first name, last name, display name и bot flag.

`participants` и `chat_participants` в v0 нет.

## Current Limitations

- один процесс и один `SQLite`-файл;
- один нейтральный assistant instruction file;
- нет summary, memory, aliases и social-QA;
- нет самостоятельных вмешательств;
- нет reply-to-bot routing;
- нет админ-команд и веб-интерфейса;
- нет полноценной очереди задач;
- observability пока ограничена локальными structured logs;
- интеграционный путь `telegram -> db -> llm -> reply` покрыт тестами через fake transport/storage, без реального Telegram API.

## Known Risks To Revisit

- понять, нужен ли minimal pending queue для нескольких одновременных explicit triggers;
- спроектировать v1/v2 добавления только после проверки v0 в проде;
- выносить assistant/judge intents и dispute tracking только после стабильного v0;
- future memory layers должны хранить только объективные события, а не free-form personality profiling.
