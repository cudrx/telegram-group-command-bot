# Product Backlog Ideas

## Next Features

- Add manual notes on participants on top of auto-generated profiles.
- Add per-participant summary and fun stats command for the chat.
- Add on-demand "what happened while we were away" summary command.
- Add configurable per-chat persona instead of one global persona.
- Add admin commands for changing `INTERJECT_PROBABILITY` and cooldown without redeploy.

## Smarter LLM Usage

- Move profile updates to a structured JSON schema with confidence scores.
- Store profile snapshots over time to reduce summary drift.
- Split long chat history into rolling windows before idle-summary compression.
- Add lightweight relevance scoring before random interjections.

## Operations

- Add Docker and deployment docs for a small VPS.
- Add structured logging and error reporting.
- Add healthcheck endpoint or watchdog-friendly heartbeat logs.
- Add graceful retries and dead-letter handling for failed summary jobs.
