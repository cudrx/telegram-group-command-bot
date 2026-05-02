# Architecture

## V1 Scope

Текущая версия проекта сведена к маленькому explicit-command ядру: один процесс с `long polling`, локальная `SQLite`, один нейтральный assistant instruction file, обычный OpenAI-compatible reply path и отдельный weekly recap path.

Бот умеет:

- читать текстовые сообщения из Telegram;
- принимать сообщения только из `TELEGRAM_CHAT_ID` и только от `TELEGRAM_ADMIN_ID` в `private`;
- сохранять чаты, входящие сообщения, исходящие сообщения, sender metadata и `reply_to` связи;
- отвечать только на явные команды `/summarize`, `/decide`, `/answer`, `/read` и admin-only `/weekly`;
- игнорировать обычный `@mention` и обычный private text;
- строить короткий human-only local context с per-intent limit;
- генерировать ответ через `generateReply`;
- сохранять исходящее bot-сообщение с `output_mode`;
- показывать Telegram `typing` во время LLM-ответа и `record_voice` во время TTS.

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
- planner/provider-driven live internet lookup is available when `TAVILY_API_KEY` is configured.

Lookup-backed decide/answer contract behaves like this:

- runtime uses an LLM planner and Tavily-backed lookup for entity grounding, fact-check, freshness or link understanding;
- planner/provider behavior is still bounded by config for provider choice, timeouts, max queries, max results and fallback handling;
- when no lookup provider is configured, planner/provider are skipped and behavior stays chat-only;
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
- weekly recap читает только cached successful media artifacts и не запускает missing media recognition work.

## Product Invariants

- главный источник истины для ответа — event log в `messages`, а не summary или memory;
- неавторизованные чаты и private-сообщения от не-админа отбрасываются до записи в БД;
- бот отвечает только когда его явно вызвали command trigger-ом;
- каждый ответ должен объясняться по логам через `trigger`, `replyToMessageId`, `context` и факт LLM-решения;
- prompt не должен содержать chat summary, participant memory, social-QA bundle, self-memory или prior messages from this bot;
- сообщения других ботов сохраняются в event log и могут быть `/answer` reply anchor, но не попадают в recent human context;
- assistant instructions управляют тоном, а не фактами;
- Telegram typing indicator является app/transport поведением и не запускает model calls.
- TTS не решает, что сказать: `/answer` сначала генерирует обычный текст, затем локальная policy решает, можно ли отправить его voice-сообщением.

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

### `src/database`

Слой хранения на `SQLite`:

- чаты;
- сообщения с `reply_to` связями;
- sender metadata прямо в `messages`;
- raw и normalized media artifacts для automatic media intake;
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
- для `/read` озвучивает replied-to text через Yandex SpeechKit без LLM;
- для поддержанных медиа запускает auto-read, проверяет artifact cache, вызывает media provider и добавляет successful summaries в нужные reply contexts;
- для `/weekly` загружает последние семь дней сообщений из `TELEGRAM_CHAT_ID`, обогащает их cached media artifacts, выбирает события, вызывает weekly LLM и публикует результат обратно в configured group chat без private confirmation;
- показывает Telegram `typing` для LLM-фазы и `record_voice` для TTS-фазы;
- форматирует исходящий ответ в Telegram-safe HTML;
- отправляет обычный текст в Telegram с `parse_mode=HTML` или voice через `sendVoice`;
- сохраняет исходящее bot-сообщение с текстовой версией ответа и `output_mode = text | voice`.
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
   - для `/answer` короткий чистый ответ может пройти локальную TTS policy; тогда Telegram получает `record_voice`, SpeechKit синтезирует `oggopus`, и бот отправляет voice вместо text;
   - если TTS не подходит или падает, ответ отправляется в Telegram с `parse_mode=HTML`;
   - БД всегда сохраняет текстовую версию ответа и фактический `output_mode`.

## Deploy Announcement Flow

1. GitHub Actions перед рестартом production контейнера записывает `/opt/test-chatbot/data/deploy-metadata.json`.
2. В контейнере файл доступен как `/app/data/deploy-metadata.json`.
3. Startup читает metadata и пропускает announcement, если файл отсутствует, невалиден, содержит `sha: "unknown"` или пустой список commits.
4. Startup сравнивает metadata `sha` с `app_state.last_announced_deploy_sha` в SQLite.
5. Если sha новый, `LLM_REPLY_MODEL` преобразует raw commit messages в короткое русское Telegram HTML-оповещение.
6. Бот отправляет оповещение в `TELEGRAM_CHAT_ID`.
7. Только после успешной отправки startup сохраняет новый sha в `app_state`.

Ошибки чтения metadata, LLM formatting или Telegram send логируются и не блокируют long polling.

## Weekly Recap Flow

1. Admin отправляет `/weekly` в private chat с ботом.
2. App-level gate разрешает команду только для `TELEGRAM_ADMIN_ID` в `private_admin` mode.
3. Weekly service читает из SQLite последние семь дней human messages для configured `TELEGRAM_CHAT_ID`.
4. Media enrichment использует только successful cached artifacts из `media_artifacts`; новые provider calls для recap не запускаются.
5. Event builder находит bursts, reply hotspots, reply chains и media moments, затем selector merge/dedupe/rank выбирает события для prompt dataset.
6. Weekly LLM получает `WEEK_STATS`, `PARTICIPANT_STATS` и `SELECTED_EVENTS`.
7. Бот отправляет итоговый recap в `TELEGRAM_CHAT_ID` и сохраняет исходящее bot-сообщение. Private confirmation админу не отправляется.

Ошибки weekly LLM или Telegram send логируются, и partial recap в группу не публикуется.

## Context Contract

### `answer`

- Команда напрямую отвечает на сообщение, на которое пользователь сделал reply командой `/answer`.
- Текст после `/answer` игнорируется.
- Reply anchor может быть human message или сообщением другого бота, но не сообщением этого бота.
- При настроенном lookup provider перед финальным ответом запускается тот же planner/Tavily lookup contract для entity grounding, fact-check, freshness или link understanding.
- Prompt assembly for `/answer` renders the reply anchor as `TARGET_MESSAGE_TO_ANSWER` and the surrounding recent chat as `NEARBY_CHAT_CONTEXT`.
- Prior messages from this bot в context не попадают.
- Короткий сгенерированный `/answer` может быть отправлен как voice, если локальная speech-cleanup/cadence policy считает его пригодным для озвучки.

### `read`

- Команда работает только как reply на текстовое сообщение.
- Автор replied-to сообщения не важен: это может быть human, этот бот или другой бот.
- Команда не вызывает LLM, media recognition, transcription или OCR.
- Текст чистится локально для речи, ограничен 500 символами и защищен cooldown 1 час per chat.
- При отсутствии provider keys, слишком длинном/неподходящем тексте, active cooldown или provider failure бот отправляет текстовый fallback.

### `summarize`

- Команда суммирует только recent human messages.
- Никаких внешних фактов, оценок, морализаторства или интернета.
- Context limit: `SUMMARIZE_CONTEXT_LIMIT=128`.
- Prior messages from this bot и сообщения других ботов в recent human context не попадают.

### `decide`

- Команда оценивает текущий спор в visible recent chat context.
- В v1 нельзя опираться на внешние факты, если lookup provider не настроен или lookup context отсутствует.
- При настроенном lookup provider behavior follows the same planner/lookup contract as `/answer` for entity grounding, fact-check, freshness or link understanding.
- Нужно явно говорить, когда победителя нет, критериев нет или контекста недостаточно.
- Context limit: `DECIDE_CONTEXT_LIMIT=64`.
- Prior messages from this bot и сообщения других ботов в recent human context не попадают.

### `weekly`

- Команда доступна только в `private_admin` mode.
- Источник данных — последние семь дней из configured `TELEGRAM_CHAT_ID`.
- Prompt dataset строится из human messages, reply links, participant stats и cached media summaries.
- Recap не вызывает Telegram media download, OCR, vision или speech-to-text provider calls.
- Результат публикуется в configured group chat без отдельного private acknowledgment.

### Media Artifacts

- Caption хранится и передаётся отдельно от результата распознавания.
- Cloudflare Vision возвращает visual artifact; OCR.space добавляет OCR artifacts; Gladia возвращает transcript artifact.
- Failed auto-read сохраняет failed artifact с коротким `errorText`, чтобы required reply flows могли не продолжать генерацию на неполном context.
- Для media albums обрабатывается только первое изображение в `chatId + mediaGroupId`; album video и следующие изображения пропускаются.
- Внутренний media prompt сохраняется для нормализации artifacts; пользовательская `/read` теперь относится только к outbound TTS для replied-to text.

Static prompt text lives under `llm/`; `src/llm/prompt-files.ts` is the single source of truth for prompt asset paths and reads prompt files when prompt builders run. TypeScript code in `src/llm/` keeps ownership of prompt assembly, sanitization, transcript labels, lookup source formatting, and runtime data insertion.

Assistant instructions загружаются отдельно из `llm/assistant/base.md` и не смешиваются с per-chat context.

## Access Modes

- `chat` mode доступен только в `TELEGRAM_CHAT_ID` для `group` и `supergroup`; здесь продолжают работать `/summarize`, `/decide`, `/answer` и `/read`.
- `private_admin` mode доступен только в `private` от `TELEGRAM_ADMIN_ID`; здесь работает `/weekly`, остальные ordinary chat commands не запускаются.

## Database Model

### `chats`

Хранит:

- тип чата;
- title;
- время последнего сообщения;
- время последнего ответа бота.
- состояние outbound TTS: последний `/answer` output mode, счетчики cadence и последний успешный `/read` voice timestamp.

### `messages`

Хранит:

- текстовые сообщения и ответы бота;
- `output_mode` для bot replies (`text` или `voice`);
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
- lookup planner/provider are skipped and behavior stays chat-only when no lookup provider is configured;
- нет самостоятельных вмешательств;
- нет reply-to-bot routing;
- нет веб-интерфейса;
- нет полноценной очереди задач;
- observability состоит из локальных structured logs и admin notifications для `warn`/`error`;
- интеграционный путь `telegram -> db -> llm -> reply` покрыт тестами через fake transport/storage, без реального Telegram API.

## Known Risks To Revisit

- понять, нужен ли durable pending queue для нескольких одновременных explicit triggers, особенно когда media calls станут медленнее обычного reply path;
- отделить fast lookup от optional deep research, чтобы обычные команды не превращались в долгие фоновые jobs без явного режима;
- уточнить, должны ли распознанные изображения, audio и video notes дополнительно отражаться в event log или достаточно `media_artifacts`;
- выносить dispute persistence, objective memory и reply-dialogues только после стабильного v1;
- future memory layers должны хранить только объективные события, а не free-form personality profiling.
