# Architecture

## MVP Scope

Текущая версия проекта рассчитана на один процесс с `long polling`, локальную `SQLite` и базовую глобальную persona с возможностью chat-specific override по `chat_id`.

Бот умеет:

- читать текстовые сообщения из Telegram;
- сохранять сообщения, чаты и участников в `SQLite`;
- хранить chat-scoped память об участниках в виде атомарных фактов вместо одной текстовой сводки;
- хранить chat-scoped aliases участников для deterministic participant resolution;
- не хранить долгосрочную self-memory самого бота в MVP; в prompt для ответа допускается только конкретное bot-сообщение, на которое отвечают, внутри causal reply context;
- добавлять per-chat persona override из `config/personas/<chat_id>.md`, если такой файл существует;
- отвечать на `@mention` и `reply`;
- иногда самостоятельно вмешиваться в беседу: вероятность и cooldown дают дешёвый candidate gate, затем отдельный LLM-слой сухо решает, стоит ли отвечать;
- запускать фоновое summary, когда чат затих и накопилось достаточно новых сообщений;
- обновлять summary чата и сжатые профили участников через OpenAI-compatible LLM слой.

## Product Invariants

Эти инварианты нужно сохранять и в следующих фичах, даже если реализация будет меняться:

- бот проектируется сразу как multi-chat система, а не как single-chat бот с последующей адаптацией;
- любые новые данные и новые фичи должны явно учитывать наличие нескольких чатов одновременно;
- при этом данные каждого чата должны оставаться строго изолированными внутри этого чата;
- по умолчанию новая память, social context, relationship data и aliases считаются `chat-scoped`, пока явно не принято другое решение;
- cross-chat leakage недопустим: данные, выводы и локальные социальные связи из одного чата не должны использоваться в другом;
- сухая аналитика ситуации и persona-слой должны оставаться разделёнными;
- аналитический слой отвечает за наблюдение, классификацию и структурированное описание происходящего в чате;
- persona-слой отвечает за стиль, тон, позицию и способ реакции на уже описанную ситуацию;
- persona не должна подменять собой слой аналитики и определять, что "происходит" в чате на уровне архитектуры;
- самостоятельные вмешательства работают по принципу `fresh-or-drop`: если после analyzed window пришли новые сообщения, решение устаревает и ответ не отправляется;
- для `reply_to_bot` генерация ответа должна опираться в первую очередь на causal reply context: текущее сообщение, bot-сообщение, на которое отвечают, его parent-сообщение и связанный prior context;
- плоское окно recent messages не должно подменять causal reply context для `reply_to_bot`, потому что оно теряет причинную связь между репликами;
- reply prompt context не должен дублировать текущее trigger-сообщение или bot-сообщение, на которое отвечают, внутри фонового transcript; `Current message` и `Message of yours being replied to` являются каноническими местами для этих сообщений, а `Earlier human context` содержит только предыдущий человеческий контекст;
- временные phrase-specific bans про конкретные метафоры или шаблоны не являются поддерживаемым архитектурным safeguard; устойчивость должна обеспечиваться структурированным контекстом ответа и тем, что summary/memory подаются как аналитический фон, а не как текст для копирования;
- если `chatSummary` описывает повтор фразы, зацикливание, malfunction или ошибку времени, reply prompt должен трактовать это как поведение, которого нужно избегать, а не как running joke или стиль для продолжения; distinctive phrases не следует копировать без необходимости;
- friendly teasing в persona-слое не должно превращаться в прямые оскорбления собеседника; если пользователь жалуется на грубость, повтор или плохую шутку, reply prompt должен просить модель не спорить, не усиливать токсичность и отвечать мягче;
- bot-derived long-term memory не является частью prompt для генерации ответа; из bot-authored текста допустимо только конкретное bot-сообщение, на которое отвечают, внутри causal reply context;
- idle summary возвращает только participant `memoryUpdates`; bot self-memory deltas не генерируются;
- social-QA ответы про участников должны быть evidence-bound: если stored participant memory отсутствует, бот не должен выдумывать устойчивые черты характера, биографию, отношения или привычки; допустимы только осторожные наблюдения из свежего видимого контекста.

## Component Map

### `src/transport`

Отвечает за Telegram-специфику:

- получает `Update` через `grammY`;
- нормализует входящее сообщение в локальный формат;
- не содержит доменных решений о том, отвечать ли боту.

### `src/domain`

Чистая логика проекта:

- определение прямого триггера ответа (`mention`, `reply_to_bot`, `none`);
- политика случайного вмешательства с `cooldown`;
- dry helpers для structured intervention analysis и fresh-or-drop проверки;
- политика запуска idle-summary;
- social intent detection и deterministic participant reference resolution.

### `src/storage`

Слой хранения на `SQLite`:

- чаты;
- участники;
- связи чат ↔ участник;
- aliases участников внутри конкретного чата;
- chat-scoped participant memories c `core` / `durable` / `volatile` стабильностью;
- сообщения с `reply_to` связями;
- summary и курсор последнего обработанного сообщения;
- retention старых summarized messages с сохранением небольшого raw-tail для локального контекста.

### `src/llm`

Изолирует работу с OpenAI-compatible LLM слоем:

- сбор prompt-контекста;
- генерация ответа персонажа;
- dry structured-анализ самостоятельного вмешательства без persona-голоса;
- генерация JSON-summary для чата и deltas по participant memories;
- выбор summary JSON режима под возможности провайдера: `response_format` или prompt-only fallback.

### `src/app`

Координирует приложение:

- принимает нормализованное сообщение;
- сохраняет его в БД;
- решает, должен ли бот отвечать;
- для самостоятельного вмешательства сначала запускает structured intervention analysis и отбрасывает устаревшие решения;
- собирает контекст;
- вызывает OpenAI-compatible LLM слой;
- отправляет ответ в Telegram;
- запускает periodic sweep для idle-summary;
- не даёт reply и summary LLM jobs для одного чата накладываться друг на друга, сохраняя один pending reply и один pending summary.

## Main Flows

### 1. Incoming Message

1. `grammY` получает новое текстовое сообщение.
2. `normalizeTextMessage` переводит его в локальный `NormalizedMessage`.
3. `DatabaseClient.saveIncomingMessage` сохраняет чат, участника и сообщение.
4. `detectDirectTrigger` и `decideReplyAction` определяют, отвечает ли бот напрямую или сообщение стало кандидатом на самостоятельное вмешательство.
5. Если ответ нужен:
   - для `interjection` берётся bounded окно сообщений до trigger-сообщения и отдельный LLM-анализ возвращает `shouldIntervene`, `situationKind`, `goal`, `intensity`, `reason`, `confidence`;
   - если анализ говорит промолчать, reply generation не запускается;
   - если после analyzed window появились новые сообщения, самостоятельное вмешательство отбрасывается по `fresh-or-drop`;
   - подтягивается глобальная persona;
   - при наличии добавляется chat-specific persona override;
   - long-term bot self-memory не подтягивается и не участвует в reply generation;
   - собирается causal reply context; для обычных триггеров он может включать bounded prior human context, но для `reply_to_bot` не должен подменяться плоским recent-window;
   - берётся текущий summary чата;
   - при social-QA резолвятся участники только внутри текущего чата; при неоднозначности бот просит уточнение без LLM-вызова;
   - собирается chat-local memory context по участнику и resolved social context bundle;
   - вызывается LLM слой;
   - ответ отправляется в Telegram и сохраняется в БД.

### 2. Idle Summary

1. Периодический sweep смотрит кандидатов с `unsummarized_message_count > 0`.
2. `shouldRunIdleSummary` проверяет:
   - чат затих на нужное время;
   - накопилось достаточно новых сообщений.
3. Берётся новый хвост сообщений после `summary_cursor_message_id`.
4. LLM слой возвращает:
   - обновлённое summary чата;
   - массив `memoryUpdates` только для участников.
5. Summary prompt должен описывать повторяющиеся ошибки, loops и time mistakes как поведение, которого нужно избегать, и не копировать точные distinctive bot phrases без необходимости.
6. БД мержит memory deltas, supersede'ит конфликтующие single-value факты, истекает volatile память и двигает курсор.

## Database Model

### `chats`

Хранит:

- тип чата;
- title;
- время последнего сообщения;
- время последнего ответа бота;
- текущее summary;
- курсор последнего summarized message;
- счётчик новых сообщений после summary.

### `participants`

Хранит:

- `user_id`;
- username, first name, last name и display name;
- время последнего появления;
- сжатый профиль участника.

### `chat_participants`

Хранит факт присутствия участника в чате, время последнего появления и chat-scoped профиль участника.

### `participant_aliases`

Хранит chat-scoped aliases для deterministic participant resolution:

- `chat_id` и `user_id`;
- исходный `alias_text` и нормализованный `alias_normalized`;
- `alias_kind`;
- `confidence`;
- время последнего наблюдения.

### `participant_memories`

Хранит атомарные факты о конкретном участнике в конкретном чате:

- `category` и `key` факта;
- текстовое значение;
- `stability` (`core` / `durable` / `volatile`);
- `source_kind` (`explicit` / `observed` / `inferred`);
- `cardinality` (`single` / `multi`);
- статус (`active` / `superseded` / `expired`);
- времена появления, подтверждения и истечения.
В MVP этот слой не используется для долгосрочной self-memory бота.

### `messages`

Хранит текстовые сообщения, ответы бота и `reply_to_telegram_message_id`, когда сообщение является ответом.

## Current Limitations

Это честные ограничения текущего `MVP`, а не забытые детали:

- один процесс и один `SQLite`-файл;
- одна глобальная persona-основа и опциональные per-chat persona overrides;
- никакой долгосрочной bot self-memory в reply path и summary path;
- нет админ-команд и веб-интерфейса;
- нет полноценной очереди задач;
- observability пока ограничена локальными structured logs;
- доменные тесты покрыты лучше, чем интеграционный путь `telegram -> db -> llm -> reply`.
- самостоятельные вмешательства v1 запускаются только на входящем сообщении после cheap probability/cooldown gate; отдельного таймера для `silence_after_activity` пока нет.

## Known Risks To Revisit

Эти вещи стоит улучшить в следующих проходах:

- улучшить стратегию обработки нескольких накопившихся reply-триггеров сверх одного pending-запроса;
- сделать более аккуратный graceful shutdown;
- расширить самостоятельные вмешательства таймерным сценарием `silence_after_activity`, чтобы бот мог оживлять чат после паузы без нового входящего сообщения.
