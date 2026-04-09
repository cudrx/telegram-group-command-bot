# Social Context MVP-1 Design

Источник: [RFC social context and participant resolution](/home/tom/Documents/Projects/test-chatbot/docs/rfcs/2026-04-09-social-context-and-participant-resolution.md)

Статус: draft для немедленного старта реализации

## Цель

Превратить RFC в первый реализуемый инкремент, который заметно улучшает качество ответов про участников чата и создаёт архитектурную базу для следующих фаз.

Этот документ намеренно сужает объём: следующий coding-pass покрывает только `participant reference resolution` и минимальный `social-QA retrieval hook`.

## Подходы

### 1. Реализовать весь RFC сразу

Плюсы:
- сразу закрывает aliases, chat signals, relationship edges и social QA;
- меньше промежуточных контрактов.

Минусы:
- слишком большой объём для одного безопасного прохода;
- высок риск расползания схемы БД и prompt-контрактов;
- сложнее тестировать причину регрессии.

### 2. Сделать MVP-1: deterministic name resolution + reply-context hook

Плюсы:
- быстро чинит основную пользовательскую боль: бот видит людей как людей, а не только как `@username`;
- даёт ясную точку расширения для `chat_social_signals` и `participant_relationship_edges`;
- укладывается в один coding-pass с понятными тестами.

Минусы:
- вопросы о связях между двумя третьими лицами останутся частично ограниченными до следующей фазы;
- локальные прозвища из summary ещё не появятся.

Рекомендация: выбрать этот вариант для следующего сообщения.

### 3. Ограничиться только cosmetic fix display names

Плюсы:
- минимальный риск;
- быстро улучшает transcript.

Минусы:
- не решает deterministic lookup;
- не даёт отдельного social-QA path;
- быстро упрётся в тот же продуктовый потолок.

## Зафиксированный Scope MVP-1

### In scope

- сделать human-first participant label вместо username-first;
- добавить chat-scoped alias index для deterministic resolution;
- научить reply path распознавать social-QA сообщения по простым эвристикам;
- до вызова LLM резолвить упомянутых участников внутри текущего чата;
- подмешивать в reply prompt структурированный social context bundle для найденных участников;
- при неоднозначном резолве возвращать safe clarification path вместо угадывания.

### Out of scope

- `chat_social_signals` storage и их влияние на тон ответа;
- `participant_relationship_edges` и evidence accumulation;
- observed nicknames из summary;
- classifier/LLM gate для intent detection;
- cross-chat identity или shared aliases между чатами;
- миграция исторических message rows.

## Product Behavior

### 1. Canonical participant label

Новые входящие сообщения должны сохраняться с human-first label:

- если есть `first_name` и `last_name`, канонический label: `First Last (@username)`;
- если есть только `first_name` и `username`, канонический label: `First (@username)`;
- если есть только `first_name`, канонический label: `First`;
- если имени нет, fallback: `@username`;
- если нет ни имени, ни username, fallback: `Unknown`.

Важно:
- `display_name` в storage должен перестать быть username-first;
- в transcript и prompt при наличии username он должен оставаться видимым рядом с человеческим именем;
- `NormalizedMessage` должен начать явно нести `fromLastName`;
- `participants` должен начать хранить `last_name`, чтобы full-name aliases можно было стабильно пересобирать на следующих апдейтах;
- исторические сообщения не переписываются.

### 2. Alias coverage для MVP-1

Для каждого участника внутри конкретного `chat_id` система должна уметь матчить:

- `@username`
- `username`
- `first_name`
- `full_name`
- текущий canonical label без служебных символов

MVP-1 не обязан поддерживать:

- уменьшительные формы;
- разговорные варианты имени;
- устойчивые локальные прозвища.

Эти варианты появятся в следующей фазе через enrichment pipeline.

### 3. Social-QA intent

Перед генерацией ответа нужен лёгкий эвристический слой `social question intent`.

Сообщение считается social-QA, если выполняется хотя бы одно условие:

- содержит вопросительные паттерны вроде `кто`, `что с`, `что между`, `какие отношения`, `кто поддерживает`, `кто с кем`;
- содержит минимум один резолвимый participant reference;
- не является чисто технической командой или пустым mention бота.

Если intent не social-QA, обычный reply flow продолжает работать без изменений, кроме улучшенных participant labels.

### 4. Name resolution rules

Перед вызовом LLM система должна:

1. нормализовать текст сообщения;
2. извлечь кандидатов из `@mentions`, unigrams и bigrams;
3. сравнить их с alias index только внутри текущего `chat_id`;
4. собрать `resolvedParticipants[]`, `ambiguousParticipants[]`, `unresolvedCandidates[]`.

Правила:

- exact match only по `alias_normalized`;
- нормализация включает lowercase, trim, collapse whitespace, удаление ведущего `@`, замену `ё -> е`;
- если alias ведёт к одному `user_id`, это успешный deterministic resolve;
- если alias ведёт к нескольким `user_id`, бот не гадает и переходит в clarification reply;
- если social-QA detected, но никого резолвить не удалось, бот отвечает осторожно, без уверенных утверждений про людей.

### 5. Clarification path

Если найден хотя бы один ambiguous participant, LLM вызывать не нужно.

Нужен deterministic ответ от orchestrator:

- короткий;
- на русском;
- перечисляет 2-3 кандидата в человекочитаемом виде;
- просит уточнить, кого именно имели в виду.

Пример целевого поведения:

`Ты про Олега (@oleg_dev) или Олега (@olegzxc)? Уточни, и я нормально раскопаю контекст.`

## Архитектура MVP-1

### 1. Изменение participant schema и новая таблица `participant_aliases`

Перед alias layer нужно расширить текущий participant storage:

- добавить `fromLastName` в `NormalizedMessage`;
- добавить nullable `last_name TEXT` в таблицу `participants`;
- обновить participant upsert так, чтобы `first_name`, `last_name` и `display_name` обновлялись согласованно.

После этого нужна отдельная таблица `participant_aliases`, даже если на первом шаге она хранит только deterministic aliases.

Контракт:

- `chat_id INTEGER NOT NULL`
- `user_id INTEGER NOT NULL`
- `alias_text TEXT NOT NULL`
- `alias_normalized TEXT NOT NULL`
- `alias_kind TEXT NOT NULL`
- `confidence REAL NOT NULL`
- `last_seen_at TEXT NOT NULL`

Ограничения и индексы:

- `UNIQUE(chat_id, user_id, alias_normalized, alias_kind)`
- индекс lookup: `(chat_id, alias_normalized)`
- `FOREIGN KEY (chat_id, user_id) REFERENCES chat_participants(chat_id, user_id) ON DELETE CASCADE`

Допустимые `alias_kind` в MVP-1:

- `username`
- `first_name`
- `full_name`
- `canonical_label`

### 2. Alias population

При каждом `upsertChatParticipant(...)` нужно синхронно обновлять aliases для этого пользователя в этом чате:

- `username`, если есть;
- `first_name`, если есть;
- `full_name`, если удалось собрать;
- human-readable canonical label без скобок и `@`.

Правила:

- alias normalization выполняется до записи;
- пустые и дублирующиеся aliases не сохраняются;
- confidence для deterministic aliases фиксированный `1.0`.

### 3. Новый domain-модуль resolver

Нужен отдельный модуль `src/domain/participant-reference-resolution.ts`.

Ответственность модуля:

- `normalizeAlias(text)`;
- `extractReferenceCandidates(text)`;
- `resolveParticipantReferences({ chatId, text, aliases })`;
- вернуть typed result с resolved, ambiguous и unresolved кандидатами.

Нельзя размазывать эту логику по `chat-orchestrator.ts` и SQL-строкам.

### 4. Новый domain-модуль social intent

Нужен отдельный модуль `src/domain/social-intent.ts`.

Ответственность:

- определить, похоже ли сообщение на social-QA;
- вернуть machine-readable reason для логов и prompt assembly.

MVP-1 использует только эвристики на regex/pattern matching.

### 5. Reply context assembly

`ChatOrchestrator.executeReplyGeneration(...)` должен собирать дополнительный bundle:

- `socialIntent: boolean`
- `socialIntentReason: string | null`
- `resolvedParticipants[]`
- `socialParticipantContexts[]`

Для каждого resolved participant нужно подтягивать:

- `userId`
- canonical label
- `participantMemoryContext`

Если social-QA активен и найдено несколько участников, в prompt надо передавать каждый из них отдельным блоком, а не сваливать всё в один текст.

### 6. Prompt contract

`buildReplyPrompt(...)` нужно расширить новыми секциями:

- `Social intent: ...`
- `Resolved participants: ...`
- `Participant social context bundle: ...`

Требования:

- секция должна явно сообщать модели, что participant resolution уже сделан детерминированно;
- если confidence низкий или данных мало, prompt должен просить аккуратный ответ без выдумывания;
- если social bundle пустой, prompt должен прямо это говорить.

## Изменения по файлам

### Обязательные изменения

- [normalize-message.ts](/home/tom/Documents/Projects/test-chatbot/src/transport/telegram/normalize-message.ts)
  перевести `displayName` на human-first canonical label и добавить `fromLastName`.
- [models.ts](/home/tom/Documents/Projects/test-chatbot/src/domain/models.ts)
  добавить типы для alias records, resolve result и social intent result.
- [database.ts](/home/tom/Documents/Projects/test-chatbot/src/storage/database.ts)
  добавить migration для `participants.last_name`, schema для `participant_aliases`, alias upsert/select и методы lookup.
- [participant-reference-resolution.ts](/home/tom/Documents/Projects/test-chatbot/src/domain/participant-reference-resolution.ts)
  вынести нормализацию и deterministic matching.
- [social-intent.ts](/home/tom/Documents/Projects/test-chatbot/src/domain/social-intent.ts)
  вынести эвристики social-QA.
- [chat-orchestrator.ts](/home/tom/Documents/Projects/test-chatbot/src/app/chat-orchestrator.ts)
  встроить resolve/clarification/prompt assembly.
- [prompts.ts](/home/tom/Documents/Projects/test-chatbot/src/llm/prompts.ts)
  добавить social context секции в reply prompt.

### Обязательные тесты

- `tests/storage-database.test.ts`
  alias persistence, lookup, chat scoping.
- новый `tests/domain/participant-reference-resolution.test.ts`
  normalize/extract/resolve/ambiguity cases.
- новый `tests/domain/social-intent.test.ts`
  positive and negative heuristics.
- `tests/chat-orchestrator.test.ts`
  clarification path и enriched reply context.
- `tests/llm-prompts.test.ts`
  social sections в prompt.

## Acceptance Criteria

- сообщение от пользователя с `first_name=Олег`, `username=oleg_dev` попадает в transcript как `Олег (@oleg_dev)`, а не просто `oleg_dev`;
- resolver внутри одного чата успешно матчит `Олег`, `@oleg_dev` и `oleg_dev` к одному `user_id`;
- одинаковый alias text в двух разных чатах не приводит к cross-chat collisions;
- при двух участниках с одинаковым `first_name` social-QA запрос приводит к clarification reply без вызова LLM;
- обычный reply path не ломается, если сообщение не social-QA;
- prompt для social-QA содержит список resolved participants и их memory contexts;
- все новые тесты проходят через `npm test`.

## Явные Non-Goals на следующий coding-pass

Следующим сообщением не нужно реализовывать:

- summary extraction of `chatSignals[]`;
- summary extraction of `relationshipUpdates[]`;
- storage merge rules для relationship evidence;
- влияние social context на interjection policy;
- alias discovery из summary.

## Следующие фазы после MVP-1

### MVP-2

- `chat_social_signals` table;
- summary schema extension с `chatSignals[]`;
- prompt section для active social signals.

### MVP-3

- `participant_relationship_edges` table;
- summary schema extension с `relationshipUpdates[]`;
- evidence accumulation и decay rules;
- richer social-QA для пар участников.
