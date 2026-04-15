# Small Fixes Backlog

Малые задачи, которые можно брать отдельно от крупных подсистем.

## v0 Reliability

- Добавить одну строку runtime-лога вида `trigger=reply_to_bot cause_message_id=... context_messages=[...] memory_used=false summary_used=false`.
- Добавить явное grounding текущего времени в reply prompt: хранить/настраивать chat-local timezone и передавать модели локальное текущее время.
- Проверить, нужен ли minimal pending queue для нескольких одновременных explicit triggers.
- Сделать более аккуратный graceful shutdown.

## Safety And Red-team

- Добавить проверку jailbreak/prompt-injection сценариев вроде “игнорируй все предыдущие инструкции”.
- Расширять offline degradation evals новыми production-сценариями после каждого найденного prompt/context regressions.

## Operations

- Добавить отчётность по ошибкам поверх текущих structured logs.
- Добавить `healthcheck`-endpoint или heartbeat-логи, удобные для watchdog.
- Добавить админ-команду или maintenance note для безопасной очистки старого SQLite перед v0-prod тестом.
