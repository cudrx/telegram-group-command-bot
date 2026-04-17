# Product Backlog Index

V1 уже включает explicit command-only task modes:

- `/explain` для объяснения replied-to сообщения;
- `/summarize` для кратких сводок по recent human chat messages;
- `/decide` для оценки текущего спора в visible recent chat context.

Следующие осмысленные расширения вне v1:

- live internet lookup inside `/explain` для задач, где модели уже недостаточно общих знаний;
- optional deep-search workflow как отдельная медленная research-надстройка поверх `/explain`, не как новый v1 command;
- dispute persistence и objective event memory для будущего structured dispute tracking;
- reply-dialogues и media-aware analysis, если потребуется разбирать не только текст;
- любой будущий memory-layer должен хранить только наблюдаемые факты и события, без free-form personality profiling.

Backlog разделён по размеру:

- [`big-features.md`](./big-features.md) — крупные подсистемы и “жирный” функционал, который мы вырезали из раннего ядра.
- [`small-fixes.md`](./small-fixes.md) — мелкие фиксы, простые фичи и эксплуатационные улучшения.
