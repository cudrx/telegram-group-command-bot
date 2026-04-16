# Architecture

## V0 Scope

Текущая версия проекта намеренно сведена к маленькому reply-only ядру: один процесс с `long polling`, локальная `SQLite`, одна глобальная persona и один OpenAI-compatible reply path.

Бот умеет:

- читать текстовые сообщения из Telegram;
- сохранять чаты, участников, входящие сообщения, исходящие сообщения и `reply_to` связи;
- отвечать только на `@mention` и `reply_to_bot`;
- строить causal reply context для `reply_to_bot`;
- строить короткий human-only local context для `mention`;
- генерировать ответ через один `generateReply`;
- сохранять исходящее bot-сообщение;
- применять deterministic reply loop guards до и после LLM-вызова;
- показывать Telegram typing indicator во время подготовки ответа.

В v0 намеренно отсутствуют:

- autonomous interjections;
- idle summary;
- participant memory;
- participant aliases;
- social-QA;
- per-chat persona overrides;
- фоновые LLM jobs;
- summary-based retention.

## Product Invariants

- главный источник истины для ответа — event log в `messages`, а не summary или memory;
- бот отвечает только когда его явно дёрнули через `@mention` или reply на сообщение бота;
- каждый ответ должен объясняться по логам через `trigger`, `replyToMessageId`, `context` и факт LLM/guard решения;
- для `reply_to_bot` causal context важнее любого recent-window;
- `Current message` и `Message of yours being replied to` не должны дублироваться в фоновом transcript;
- prompt не должен содержать chat summary, participant memory, social-QA bundle или self-memory;
- prompt-facing context may be sanitized, but the raw SQLite event log remains unchanged;
- production recovery from bot self-degradation must not require deleting old SQLite messages;
- repeated bot anchors must be omitted before prompt construction rather than relying only on prompt instructions;
- current user text must never be removed by sanitizer, even when it contains a repeated phrase;
- persona управляет тоном, а не фактами;
- deterministic guards запускаются до платного LLM-вызова, когда локального контекста достаточно;
- repeated reply chains hide unsafe bot anchor text before prompt construction instead of sending a synthetic loop-breaker reply;
- post-LLM duplicate guard может пропустить near-duplicate ответ, но не заменяет его синтетической репликой и не делает второй LLM-вызов;
- Telegram typing indicator является app/transport поведением и не запускает model calls.

## Component Map

### `src/transport`

Отвечает за Telegram-специфику:

- получает `Update` через `grammY`;
- нормализует входящее сообщение в локальный `NormalizedMessage`;
- не содержит доменных решений о том, отвечать ли боту.

### `src/domain`

Чистая логика проекта:

- определение прямого триггера ответа (`mention`, `reply_to_bot`, `none`);
- решение `reply` / `ignore`;
- deterministic reply loop guards;
- текстовая near-duplicate нормализация.

### `src/storage`

Слой хранения на `SQLite`:

- чаты;
- участники;
- связи чат ↔ участник;
- сообщения с `reply_to` связями.

### `src/llm`

Изолирует работу с OpenAI-compatible LLM слоем:

- сбор reply prompt;
- генерация ответа персонажа;
- timeout/retry и логирование LLM input/output при `LOG_LLM_TEXT=true`.

### `src/app`

Координирует приложение:

- принимает нормализованное сообщение;
- сохраняет его в БД;
- решает, должен ли бот отвечать;
- собирает context;
- запускает deterministic guards;
- вызывает OpenAI-compatible reply LLM;
- показывает Telegram typing indicator;
- отправляет ответ в Telegram;
- сохраняет исходящее bot-сообщение.

## Main Flow

1. `grammY` получает новое текстовое сообщение.
2. `normalizeTextMessage` переводит его в локальный `NormalizedMessage`.
3. `DatabaseClient.saveIncomingMessage` сохраняет чат, участника и сообщение.
4. `detectDirectTrigger` и `decideReplyAction` определяют `mention`, `reply_to_bot` или `ignore`.
5. Если ответ не нужен, pipeline заканчивается.
6. Если ответ нужен:
   - подтягивается базовая persona;
   - строится `ReplyContext`;
   - preflight guard может пропустить слишком частый reply-to-bot или скрыть повторяющийся bot anchor перед prompt construction;
   - dangerous repeated bot anchors are sanitized before prompt construction;
   - вызывается один reply LLM;
   - postflight duplicate guard может пропустить near-duplicate output;
   - Telegram получает best-effort `typing` action и bounded delay;
   - ответ отправляется в Telegram и сохраняется в БД.

## Context Contract

### `reply_to_bot`

Порядок важности:

1. Current user message
2. Bot message being replied to
3. Parent human cause, если есть
4. 2-4 earlier human messages max
5. Persona

### `mention`

Порядок важности:

1. Current mention message
2. Последние human messages в пределах `MESSAGE_CONTEXT_LIMIT`
3. Persona

## Database Model

### `chats`

Хранит:

- тип чата;
- title;
- время последнего сообщения;
- время последнего ответа бота.

### `participants`

Хранит:

- `user_id`;
- username, first name, last name и display name;
- время последнего появления.

### `chat_participants`

Хранит факт присутствия участника в чате и время последнего появления.

### `messages`

Хранит текстовые сообщения, ответы бота и `reply_to_telegram_message_id`, когда сообщение является ответом.

## Current Limitations

- один процесс и один `SQLite`-файл;
- одна глобальная persona;
- нет per-chat persona override;
- нет summary, memory, aliases и social-QA;
- нет самостоятельных вмешательств;
- нет админ-команд и веб-интерфейса;
- нет полноценной очереди задач;
- observability пока ограничена локальными structured logs;
- интеграционный путь `telegram -> db -> llm -> reply` покрыт тестами через fake transport/storage, без реального Telegram API.

## Known Risks To Revisit

- понять, нужен ли minimal pending queue для нескольких одновременных explicit triggers;
- решить, когда возвращать read-only explicit participant facts;
- сделать более аккуратный graceful shutdown;
- спроектировать v1/v2 добавления только после проверки v0 в проде.
