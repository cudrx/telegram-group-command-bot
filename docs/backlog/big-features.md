# Big Feature Backlog

Крупные подсистемы, которые нельзя возвращать пачкой. Каждую нужно проектировать, включать отдельно и проверять в проде поверх стабильного v1.

## Lookup And Research Extensions

Current priority:

- internet-backed lookup for `/explain`, когда общих знаний модели уже недостаточно;
- internet-backed factual support for `/decide`, только когда спор зависит от проверяемых внешних фактов;
- shared source/evidence envelope for fetched pages, snippets, timestamps and provider metadata, so prompt input stays auditable.

Later:

- optional deep-search workflow как отдельная исследовательская надстройка поверх `/explain`;
- source-carrying research output with citations, if user-facing traceability becomes required;
- read-only retrieval поверх event log без превращения его в free-form memory.

Constraints:

- `/summarize` remains chat-only.
- Lookup must be explicit-command scoped and must not reintroduce autonomous interjections.
- The bot should say when lookup failed, timed out, or produced weak evidence instead of hiding uncertainty.

## Judge And Dispute Tracking

- dispute persistence между сессиями;
- objective event memory для хранения проверяемых событий, решений и связок доказательств;
- dispute timeline, который показывает, какие сообщения и факты привели к выводу;
- read-only retrieval поверх event memory без free-form personality profiling;
- future memory updates должны быть только объективными наблюдениями, цитатами или структурированными событиями.

## Richer Conversation Surfaces

- media intake for images, audio files, Telegram voice messages, and Telegram video notes ("кружочки");
- image recognition and OCR where useful for `/explain`;
- audio/video-note transcription into text artifacts that can be stored and referenced by explicit commands;
- reply-dialogues для threaded follow-up analysis;
- interface support for reviewing why the assistant reached a decision without reopening the whole chat.

Media constraints:

- Store original Telegram file metadata and derived text/description separately.
- Treat recognized media content as untrusted user content in prompts.
- Do not run media analysis for unrelated chat messages unless an explicit command needs it.

## Explicitly Out Of Scope For This Backlog

- social profiling;
- personality modelling;
- inferred participant traits;
- relationship graphs built из догадок, а не из событий;
- mimicry of people or chat groups;
- autonomous interjections.
