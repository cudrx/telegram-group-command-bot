# Architecture

## V1 Scope

Текущая версия проекта сведена к маленькому explicit-command ядру: один процесс с `long polling`, локальная `SQLite`, один нейтральный assistant instruction file и один OpenAI-compatible reply path.

Бот умеет:

- читать текстовые сообщения из Telegram;
- принимать сообщения только из `TELEGRAM_CHAT_ID` и только от `TELEGRAM_ADMIN_ID` в `private`;
- сохранять чаты, входящие сообщения, исходящие сообщения, sender metadata и `reply_to` связи;
- отвечать только на явные команды `/summarize`, `/decide` и `/answer`;
- игнорировать обычный `@mention`, обычный private text и все текущие команды в `private_admin`;
- строить короткий human-only local context с per-intent limit;
- генерировать ответ через `generateReply`;
- сохранять исходящее bot-сообщение;
- показывать Telegram typing indicator во время подготовки ответа.

В v1 намеренно отсутствуют:

- autonomous interjections;
- idle summary;
- participant memory;
- participant aliases;
- social-QA;
- per-chat overrides;
- reply-to-bot routing;
- фоновые LLM jobs;
- summary-based retention;
- planner/provider-driven live internet lookup is enabled by default and can be disabled with `LOOKUP_ENABLED=false`.

Если `LOOKUP_ENABLED=true`, lookup-backed decide/answer contract behaves like this:

- runtime uses an LLM planner and Tavily-backed lookup for entity grounding, fact-check, freshness or link understanding;
- planner/provider behavior is still bounded by config for provider choice, timeouts, max queries, max results and fallback handling;
- when `LOOKUP_ENABLED=false`, planner/provider are skipped and behavior stays chat-only;
- `EXTERNAL_LOOKUP_CONTEXT` is appended to the prompt as untrusted evidence, not instructions.

Media intake работает автоматически для поддержанных входящих медиа в авторизованных чатах:

- поддерживаются `photo`, image `document`, `voice`, `audio` и Telegram `video_note`;
- после сохранения сообщения запускается in-process auto-read coordinator;
- durable results сохраняются в `media_artifacts`, а in-memory map используется только для дедупликации текущих provider calls;
- `/answer` ждёт target media и пропускает ответ, если required media failed;
- `/decide` ждёт media из своего context window и пропускает ответ, если required media failed;
- `/summarize` ждёт только уже in-flight media из context window и не стартует missing reads;
- изображения проходят через Cloudflare Workers AI для `vision_description`, который дает только визуальное описание, а не OCR;
- OCR.space сохраняет отдельные текстовые артефакты `ocr_text_ru` для `language=rus` и `OCREngine=2`, а также `ocr_text_default` без `language` и с `OCREngine=2`;
- пустые OCR-результаты не сохраняются;
- image flow продолжается, если доступен хотя бы один из артефактов `vision_description`, `ocr_text_ru` или `ocr_text_default`;
- `voice`, `audio` и Telegram `video_note` транскрибируются через Gladia;
- исходные файлы скачиваются во временную папку, удаляются после provider call и не сохраняются в БД;
- в SQLite сохраняются только raw/normalized media artifacts с TTL.

## Product Invariants

- главный источник истины для ответа — event log в `messages`, а не summary или memory;
- неавторизованные чаты и private-сообщения от не-админа отбрасываются до записи в БД;
- бот отвечает только когда его явно вызвали command trigger-ом;
- каждый ответ должен объясняться по логам через `trigger`, `replyToMessageId`, `context` и факт LLM-решения;
- prompt не должен содержать chat summary, participant memory, social-QA bundle, self-memory или prior messages from this bot;
- сообщения других ботов сохраняются в event log и могут быть `/answer` reply anchor, но не попадают в recent human context;
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

- определение прямого триггера ответа (`command`, `none`) с учетом `chat` vs `private_admin` mode;
- решение `reply` / `ignore`.

### `src/storage`

Слой хранения на `SQLite`:

- чаты;
- сообщения с `reply_to` связями;
- sender metadata прямо в `messages`;
- raw и normalized media artifacts для automatic media intake.
- маленький `app_state` key-value store для persistent runtime state, например последнего успешно объявленного deploy sha.

### `src/llm`

Изолирует работу с OpenAI-compatible LLM слоем:

- загрузка статических prompt-файлов из `llm/`;
- сбор reply prompt и безопасная вставка runtime context;
- генерация ответа assistant-core;
- форматирование deploy update announcements через fast reply model;
- timeout/retry и логирование LLM input/output при `LOG_LLM_TEXT=true`.

### `src/app`

Координирует приложение:

- принимает нормализованное сообщение;
- отбрасывает неавторизованные сообщения до `ChatOrchestrator` и до записи в SQLite;
- помечает разрешенное сообщение как `chat` или `private_admin`;
- сохраняет его в БД;
- решает, должен ли бот отвечать;
- собирает context;
- вызывает OpenAI-compatible reply LLM;
- для поддержанных медиа запускает auto-read, проверяет artifact cache, вызывает media provider и добавляет successful summaries в нужные reply contexts;
- показывает Telegram typing indicator;
- форматирует исходящий ответ в Telegram-safe HTML;
- отправляет ответ в Telegram с `parse_mode=HTML`;
- сохраняет исходящее bot-сообщение в том же отформатированном виде.
- на старте читает deploy metadata, дедупит deploy announcement по SQLite и отправляет одно Telegram-оповещение о новой версии после успешного форматирования.

## Main Flow

1. `grammY` получает новое текстовое сообщение.
2. `normalizeTextMessage` переводит его в локальный `NormalizedMessage`.
3. App-level access gate пропускает только `TELEGRAM_CHAT_ID` и `private` от `TELEGRAM_ADMIN_ID`, затем выставляет `authorizedMode`.
4. `DatabaseClient.saveIncomingMessage` сохраняет только разрешенный чат и сообщение.
5. `detectDirectTrigger` и `decideReplyAction` определяют `command` или `ignore`.
6. Если ответ не нужен, pipeline заканчивается.
7. Если ответ нужен:
   - подтягиваются assistant instructions;
   - строится `ReplyContext` с recent human messages only;
   - вызывается reply LLM;
   - Telegram получает best-effort `typing` action и bounded delay;
   - ответ нормализуется в Telegram-safe HTML;
   - ответ отправляется в Telegram с `parse_mode=HTML` и сохраняется в БД.

## Deploy Announcement Flow

1. GitHub Actions перед рестартом production контейнера записывает `/opt/test-chatbot/data/deploy-metadata.json`.
2. В контейнере файл доступен как `/app/data/deploy-metadata.json`.
3. Startup читает metadata и пропускает announcement, если файл отсутствует, невалиден, содержит `sha: "unknown"` или пустой список commits.
4. Startup сравнивает metadata `sha` с `app_state.last_announced_deploy_sha` в SQLite.
5. Если sha новый, `LLM_REPLY_MODEL` преобразует raw commit messages в короткое русское Telegram HTML-оповещение.
6. Бот отправляет оповещение в `TELEGRAM_CHAT_ID`.
7. Только после успешной отправки startup сохраняет новый sha в `app_state`.

Ошибки чтения metadata, LLM formatting или Telegram send логируются и не блокируют long polling.

## Context Contract

### `answer`

- Команда напрямую отвечает на сообщение, на которое пользователь сделал reply командой `/answer`.
- Текст после `/answer` игнорируется.
- Reply anchor может быть human message или сообщением другого бота, но не сообщением этого бота.
- При `LOOKUP_ENABLED=true` перед финальным ответом запускается тот же planner/Tavily lookup contract для entity grounding, fact-check, freshness или link understanding.
- Prompt assembly for `/answer` renders the reply anchor as `TARGET_MESSAGE_TO_ANSWER` and the surrounding recent chat as `NEARBY_CHAT_CONTEXT`.
- Prior messages from this bot в context не попадают.

### `summarize`

- Команда суммирует только recent human messages.
- Никаких внешних фактов, оценок, морализаторства или интернета.
- Context limit: `SUMMARIZE_CONTEXT_LIMIT=128`.
- Prior messages from this bot и сообщения других ботов в recent human context не попадают.

### `decide`

- Команда оценивает текущий спор в visible recent chat context.
- В v1 нельзя опираться на внешние факты, если `LOOKUP_ENABLED=false`.
- При `LOOKUP_ENABLED=true` behavior follows the same planner/lookup contract as `/answer` for entity grounding, fact-check, freshness or link understanding.
- Нужно явно говорить, когда победителя нет, критериев нет или контекста недостаточно.
- Context limit: `DECIDE_CONTEXT_LIMIT=64`.
- Prior messages from this bot и сообщения других ботов в recent human context не попадают.

### Media Artifacts

- Caption хранится и передаётся отдельно от результата распознавания.
- Cloudflare Vision возвращает visual artifact; OCR.space добавляет OCR artifacts; Gladia возвращает transcript artifact.
- Failed auto-read сохраняет failed artifact с коротким `errorText`, чтобы required reply flows могли не продолжать генерацию на неполном context.
- Для media albums обрабатывается только первое изображение в `chatId + mediaGroupId`; album video и следующие изображения пропускаются.
- Внутренний media prompt сохраняется для нормализации artifacts, но пользовательской команды `/read` больше нет.

Static prompt text lives under `llm/`; `src/llm/prompt-files.ts` is the single source of truth for prompt asset paths and reads prompt files when prompt builders run. TypeScript code in `src/llm/` keeps ownership of prompt assembly, sanitization, transcript labels, lookup source formatting, and runtime data insertion.

Assistant instructions загружаются отдельно из `llm/assistant/base.md` и не смешиваются с per-chat context.

## Access Modes

- `chat` mode доступен только в `TELEGRAM_CHAT_ID` для `group` и `supergroup`; здесь продолжают работать `/summarize`, `/decide` и `/answer`.
- `private_admin` mode доступен только в `private` от `TELEGRAM_ADMIN_ID`; в текущей версии он зарезервирован под будущую админ-панель и не принимает текущие пользовательские команды.

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

`participants` и `chat_participants` в v1 нет.

### `app_state`

Хранит маленькие persistent runtime values:

- `last_announced_deploy_sha` — последний deploy sha, для которого Telegram announcement был успешно отправлен.

## Current Limitations

- один процесс и один `SQLite`-файл;
- один нейтральный assistant instruction file;
- нет dispute persistence, objective event memory и reply-dialogues;
- lookup planner/provider are skipped and behavior stays chat-only when `LOOKUP_ENABLED=false`;
- нет самостоятельных вмешательств;
- нет reply-to-bot routing;
- нет админ-команд и веб-интерфейса;
- нет полноценной очереди задач;
- observability состоит из локальных structured logs и admin notifications для `warn`/`error`;
- интеграционный путь `telegram -> db -> llm -> reply` покрыт тестами через fake transport/storage, без реального Telegram API.

## Known Risks To Revisit

- понять, нужен ли durable pending queue для нескольких одновременных explicit triggers, особенно когда media calls станут медленнее обычного reply path;
- отделить fast lookup от optional deep research, чтобы обычные команды не превращались в долгие фоновые jobs без явного режима;
- уточнить, должны ли распознанные изображения, audio и video notes дополнительно отражаться в event log или достаточно `media_artifacts`;
- выносить dispute persistence, objective memory и reply-dialogues только после стабильного v1;
- future memory layers должны хранить только объективные события, а не free-form personality profiling.
