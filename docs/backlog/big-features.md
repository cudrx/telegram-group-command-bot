# Big Feature Backlog

Крупные подсистемы, которые нельзя возвращать пачкой. Каждую нужно проектировать, включать отдельно и проверять в проде поверх стабильного v0.

## Assistant Intents

- `explain`: объяснить, что происходит в чате или в текущем контексте.
- `summarize`: собрать краткое структурированное резюме по фактам из event log.
- `decide`: помочь выбрать вариант на основе явных критериев.
- `find`: искать конкретный факт, сообщение или упоминание в истории.

## Judge And Dispute Tracking

- отдельный judge-слой для разбирательства споров, где ответ должен опираться на наблюдаемые сообщения, а не на догадки о людях;
- objective event memory для хранения проверяемых событий, решений и связок доказательств;
- dispute timeline, который показывает, какие сообщения и факты привели к выводу;
- read-only retrieval поверх event memory без free-form personality profiling;
- future memory updates должны быть только объективными наблюдениями, цитатами или структурированными событиями.

## Explicitly Out Of Scope For This Backlog

- social profiling;
- personality modelling;
- inferred participant traits;
- relationship graphs built из догадок, а не из событий;
- mimicry of people or chat groups;
- autonomous interjections.
