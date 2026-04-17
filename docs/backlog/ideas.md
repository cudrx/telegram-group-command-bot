# Product Backlog Index

## Current Priority

Ближайшая актуальная работа после текущего explicit-command ядра:

1. Internet-backed `/explain` for factual questions, links, named entities, current events and cases where general model knowledge is not enough.
2. Internet-backed factual support for `/decide`, only when the dispute depends on checkable external facts; subjective/value disputes stay chat-only.
3. Media intake: recognize images, transcribe audio/voice messages, and transcribe Telegram video notes ("кружочки") so `/explain` and later `/decide` can reason over their contents.

Эти фичи должны расширять существующие команды, а не возвращать autonomous replies, social memory or a fourth generic search command.

V1 уже включает explicit command-only task modes:

- `/explain` для объяснения replied-to сообщения;
- `/summarize` для кратких сводок по recent human chat messages;
- `/decide` для оценки текущего спора в visible recent chat context.

Следующие осмысленные расширения вне v1:

- live internet lookup inside `/explain` для задач, где модели уже недостаточно общих знаний;
- fact lookup inside `/decide`, только для проверяемых внешних утверждений, когда чатовый контекст сам по себе недостаточен;
- media intake для картинок, аудио, voice messages и video notes, сначала как распознанный текст/описание для explicit commands;
- optional deep-search workflow как отдельная медленная research-надстройка поверх `/explain`, не как новый v1 command;
- dispute persistence и objective event memory для будущего structured dispute tracking;
- reply-dialogues, если потребуется threaded follow-up analysis;
- любой будущий memory-layer должен хранить только наблюдаемые факты и события, без free-form personality profiling.

Backlog разделён по размеру:

- [`big-features.md`](./big-features.md) — крупные подсистемы и “жирный” функционал, который мы вырезали из раннего ядра.
- [`small-fixes.md`](./small-fixes.md) — мелкие фиксы, простые фичи и эксплуатационные улучшения.
