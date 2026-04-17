# Big Feature Backlog

Крупные подсистемы, которые нельзя возвращать пачкой. Каждую нужно проектировать, включать отдельно и проверять в проде поверх стабильного v1.

## Lookup And Research Extensions

- internet-backed lookup for `/explain`, когда общих знаний модели уже недостаточно;
- optional deep-search workflow как отдельная исследовательская надстройка поверх `/explain`;
- source-carrying research output, если позже понадобится цитирование и traceability;
- read-only retrieval поверх event log без превращения его в free-form memory.

## Judge And Dispute Tracking

- dispute persistence между сессиями;
- objective event memory для хранения проверяемых событий, решений и связок доказательств;
- dispute timeline, который показывает, какие сообщения и факты привели к выводу;
- read-only retrieval поверх event memory без free-form personality profiling;
- future memory updates должны быть только объективными наблюдениями, цитатами или структурированными событиями.

## Richer Conversation Surfaces

- reply-dialogues для threaded follow-up analysis;
- media-aware analysis for images, voice notes, and attachments;
- interface support for reviewing why the assistant reached a decision without reopening the whole chat.

## Explicitly Out Of Scope For This Backlog

- social profiling;
- personality modelling;
- inferred participant traits;
- relationship graphs built из догадок, а не из событий;
- mimicry of people or chat groups;
- autonomous interjections.
