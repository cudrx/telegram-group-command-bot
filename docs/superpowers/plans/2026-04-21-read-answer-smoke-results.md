# Read / Answer / Explain / Summarize / Decide Smoke Results

Generated at: 2026-04-21T10:57:29.323Z

## Eval Scope

The compact intent eval set now contains 6 fixtures:

- `read-vision-meme`
- `read-audio-transcript`
- `answer-factual-question`
- `explain-factual-question-meaning`
- `summarize-basic-discussion`
- `decide-basic-dispute`

## Runs

### Full 6-Fixture Run

Command:

```bash
set -a; . ./.env; set +a; npm run eval:intents
```

Run directory:

```text
.eval-runs/2026-04-21T10-54-25-020Z
```

Result:

- `read-audio-transcript`: passed
- `answer-factual-question`: passed
- `explain-factual-question-meaning`: passed
- `summarize-basic-discussion`: passed
- `decide-basic-dispute`: passed
- `read-vision-meme`: failed because the response included style/mood wording (`атмосфера`, `мрачная`)

### Targeted Follow-Up Run

After tightening the image `read` prompt and `read-vision-meme` rubric, only the failing eval was rerun.

Command:

```bash
set -a; . ./.env; set +a; npm run eval:intents -- --id=read-vision-meme
```

Run directory:

```text
.eval-runs/2026-04-21T10-57-29-323Z
```

Result:

- `read-vision-meme`: passed

## Latest `read-vision-meme` Response

```text
Leon, necesito que distraigas a Kingpin

Original: Leon, necesito que distraigas a Kingpin

На изображении два человека в помещении, похожем на коридор. Один в чёрной маске с красным логотипом, другой в чёрной куртке. Видны светильники и колонны.
```

## Notes

- The final follow-up intentionally reran only the failing eval instead of the full suite.
- Local unit tests, lint, and build were run separately before commit.
