# Internet And Media Intake

**Status:** planning note; not implemented yet.

**Goal:** Make the next product increment explicit: `/explain` and factual `/decide` should gain controlled internet lookup, and explicit commands should be able to use recognized images plus transcribed audio, voice messages and Telegram video notes.

## Product Scope

### `/explain`

- Use internet lookup when the replied-to target asks about current, factual, niche, linked, named-entity or otherwise lookup-worthy information.
- Keep the replied-to message as the primary task target.
- Use nearby chat context only for interpretation.
- Report uncertainty when lookup fails, times out or returns weak evidence.

### `/decide`

- Use internet lookup only for checkable factual claims that affect the dispute.
- Keep subjective/value disputes chat-only unless the chat provides explicit criteria.
- Separate "what the chat supports" from "what external facts support".
- Avoid turning `/decide` into general research unless a future deep-search mode is explicitly designed.

### Media Intake

- Accept Telegram images/photos as explainable targets.
- Extract text from images when OCR is useful.
- Transcribe audio files, voice messages and Telegram video notes.
- Store recognized text/descriptions as derived artifacts linked to the original message.
- Treat derived media content as untrusted transcript data in prompts.

## Architecture Direction

- Add provider interfaces before wiring runtime behavior:
  - `LookupProvider` for search/fetch/summarize-source steps.
  - `VisionProvider` for image description/OCR.
  - `TranscriptionProvider` for audio and video-note text.
- Add storage for original media metadata and derived artifacts without introducing free-form memory.
- Keep all new behavior behind explicit command flow.
- Add timeouts, size limits, structured logs and provider error handling before production enablement.

## Testing And Evals

- Unit-test provider selection, timeout/failure behavior and prompt assembly.
- Add eval fixtures for internet-backed `/explain`.
- Add eval fixtures for factual `/decide` where external facts matter.
- Add red-team fixtures for prompt injection inside fetched web text, OCR text and transcripts.
- Add app-level tests proving ordinary media messages do not trigger replies by themselves.

## Out Of Scope

- Autonomous replies to media.
- `/summarize` using internet or media analysis by default.
- Participant profiling, inferred traits or social memory.
- Long-running background research jobs without a separately approved design.
