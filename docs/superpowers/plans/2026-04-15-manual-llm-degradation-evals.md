# Manual LLM Degradation Evals

These evals intentionally call the configured LLM provider. Codex must not run them. The project owner runs them manually.

## Setup

- Use a throwaway Telegram test chat or a local harness that logs `llm.reply.request` and `llm.reply.response`.
- Set `LOG_LLM_TEXT=true`.
- Keep the same persona file used in production unless intentionally testing persona changes.
- Save the prompt and response for every failed case.

## Pass Criteria

- The bot answers the current user message instead of continuing its own previous phrase.
- The bot does not reuse repeated anchors such as `хрю-хрю`, `дерьмишко`, `на поезде`, or `покушал деда` unless the current user message explicitly asks about that phrase.
- The bot stays concise: usually one or two short Telegram-style lines.
- The bot does not turn a single short user message into a new monologue.

## Scenarios

### Scenario 1: Хрю Loop Reply

Seed or reproduce:

1. User: `Можешь хрюкнуть?`
2. Bot: `хрю-хрю`
3. User: `Сука` as reply to the bot message.

Expected:

- Acceptable: short acknowledgement, de-escalation, or dry joke.
- Failure: `хрю-хрю-сук-хрю` or any continuation of the bot's previous sound pattern.

### Scenario 2: Дерьмишко Anchor

Seed or reproduce repeated bot replies containing `дерьмишко`, then send:

`@hrupa_bot говнишко или все же дерьмишко?`

Expected:

- Acceptable: answers the comparison briefly.
- Failure: imports old `поезд`, `покушал деда`, or repeated `хрю-хрю` anchors.

### Scenario 3: Зеленый Слоник Drift

After previous bot loop messages, send:

`Зелёный слоник 2`

Expected:

- Acceptable: short reaction to the phrase.
- Failure: repeats old unrelated anchors like `покушал деда`, `дерьмишко на поезде`, or `хрю-хрю`.

### Scenario 4: Normal Causal Reply Still Works

Send:

1. User: `@hrupa_bot как тебе в целом живется? напиши развернутый ответ.`
2. Bot gives a normal non-looping answer.
3. User replies to bot: `почему?`

Expected:

- Acceptable: uses the bot's previous answer as context.
- Failure: previous bot answer is omitted even though it was not repetitive.

## Recording Results

For each failure, record:

- scenario name;
- current user message;
- whether it was `mention` or `reply_to_bot`;
- sanitized prompt excerpt;
- model response;
- why it failed.
