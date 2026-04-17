# Product Backlog Index

Сначала стабилизируем v0:

- бот отвечает только на `@mention`;
- контекст маленький и объяснимый;
- summary, memory, aliases, social-QA и interjections не участвуют в runtime;
- новые “умные” слои возвращаются только по одному после проверки в проде.

Следующие осмысленные расширения вне v0:

- assistant intents вроде `explain`, `summarize`, `decide` и `find`;
- judge intents для разбора споров и вынесения структурированного решения;
- objective event memory как опора для будущего dispute tracking;
- любой будущий memory-layer должен хранить только наблюдаемые факты и события, без free-form personality profiling.

Backlog разделён по размеру:

- [`big-features.md`](./big-features.md) — крупные подсистемы и “жирный” функционал, который мы вырезали из v0.
- [`small-fixes.md`](./small-fixes.md) — мелкие фиксы, простые фичи и эксплуатационные улучшения.
