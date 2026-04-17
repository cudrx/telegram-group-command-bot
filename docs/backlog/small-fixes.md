# Small Fixes Backlog

Малые задачи, которые можно брать отдельно от крупных подсистем.

## v1 Reliability

- Добавить одну строку runtime-лога вида `trigger=command intent=... cause_message_id=... context_messages=[...] memory_used=false summary_used=false`.
- Добавить явное grounding текущего времени в reply prompt: хранить/настраивать chat-local timezone и передавать модели локальное текущее время.
- Проверить, нужен ли minimal pending queue для нескольких одновременных explicit triggers.
- Перед internet/media этапом добавить command lifecycle statuses для долгих операций: started, lookup/media_fetch, llm_call, sent/failed.
- Сделать более аккуратный graceful shutdown.

## Safety And Red-team

- Добавить проверку jailbreak/prompt-injection сценариев вроде “игнорируй все предыдущие инструкции”.
- Добавить prompt-injection fixtures для web pages, OCR text и transcription text before enabling lookup/media in prompts.
- Расширить command-intent eval pack production-сценариями после стабилизации v1.

## Operations

- Добавить отчётность по ошибкам поверх текущих structured logs.
- Добавить `healthcheck`-endpoint или heartbeat-логи, удобные для watchdog.
- Добавить timeouts, size limits и failure counters для future lookup/media providers.
- Добавить админ-команду или maintenance note для безопасной очистки старого SQLite перед v0-prod тестом.
