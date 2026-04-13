# Product Backlog Index

Сначала стабилизируем v0:

- бот отвечает только на `@mention` и `reply_to_bot`;
- контекст маленький и объяснимый;
- summary, memory, aliases, social-QA и interjections не участвуют в runtime;
- новые “умные” слои возвращаются только по одному после проверки в проде.

Backlog разделён по размеру:

- [`big-features.md`](./big-features.md) — крупные подсистемы и “жирный” функционал, который мы вырезали из v0.
- [`small-fixes.md`](./small-fixes.md) — мелкие фиксы, простые фичи и эксплуатационные улучшения.
