# Auto-Read Media Design

## Context

The bot currently analyzes media mostly on demand. Explicit `read` replies run
media recognition, while `answer` and `decide` lazily warm only the newest nearby
media when needed. The production smoke database in `data/prod-smoke.sqlite`
shows a small media volume: 44 media messages, all photos, with a partial set of
stored media artifacts.

The desired behavior is to process supported incoming media automatically, store
the resulting artifacts, and make later reply flows consume those artifacts
instead of discovering media work at reply time.

## Goals

- Automatically run the internal read pipeline for supported media in authorized
  chats, even when the bot is not explicitly called.
- Store media artifacts so `answer`, `decide`, and `summarize` can reuse them.
- Remove the user-facing `read` command while keeping the internal media
  extraction pipeline.
- Avoid a durable job queue in the first version.
- Keep reply behavior predictable: flows that require media should not answer as
  if the media did not exist.
- Add a general admin notification channel for operational warnings and errors.

## Non-Goals

- Do not introduce a SQLite-backed durable queue in the first version.
- Do not support ordinary Telegram `video` media yet.
- Do not fully model album ordering with debounce timers.
- Do not send media-processing failure messages into the group chat.

## Supported Media

Auto-read handles:

- `photo`
- `document_image`
- `voice`
- `audio`
- `video_note`

Ordinary `video` is ignored for now. `video_note` is handled as audio
transcription.

## Architecture

Add an auto-read layer to the existing media support code:

- `startAutoReadForIncomingMessage(message, logger)`
- `ensureAutoReadComplete(request, media, logger)`
- `waitForInFlightAutoRead(media)`

`startAutoReadForIncomingMessage` runs after a message is successfully saved. It
starts media processing in the background and returns without blocking normal
message intake.

`ensureAutoReadComplete` is used by reply flows that depend on media. It checks
for a successful artifact, waits for an in-flight task when one exists, or starts
the same read pipeline as a fallback when the bot restarted or the artifact is
missing.

An in-memory map deduplicates concurrent work in the current process. The key is
`file_unique_id + media profile` when `file_unique_id` exists, otherwise
`chat_id + telegram_message_id + media profile`. The database remains the
source of persisted results.

The existing newest-nearby-media lazy warm path should be removed once this
common auto-read path exists.

## Flow Behavior

`answer`:

- If the target or reply-anchor message has supported media, wait for auto-read.
- If auto-read fails after retries, do not run the answer flow.
- If there is no relevant media, behave as today.

`decide`:

- Wait for supported media in the decide context window.
- If any required context media fails after retries, do not run the decide flow.
- Use successful artifacts to enrich context messages.

`summarize`:

- Include media summaries in the summary context when successful artifacts are
  available.
- Wait for already in-flight auto-read tasks for media in the summary window.
- Do not start missing media reads from `summarize`.
- Do not retry from `summarize`.
- If a media artifact is absent or failed, summarize without that media summary.

`read`:

- Remove the user-facing command and intent behavior from response policy,
  documentation, and eval expectations.
- Keep internal media extraction prompts/helpers as implementation details unless
  a later cleanup renames them.

## Albums

Add `mediaGroupId` to normalized and stored messages, backed by
`messages.media_group_id`.

For album messages:

- Video entries are ignored.
- The first image that arrives for a given `chatId + mediaGroupId` starts
  auto-read.
- Later images in the same album are skipped when an image for that album is
  already in-flight or has a successful artifact.
- No debounce timer is used. This may choose the first delivered image rather
  than the earliest Telegram message if delivery order is unusual, which is
  acceptable for the first version.

Audio and `video_note` outside albums are processed as standalone media.

## Retries And Failures

Auto-read performs up to two attempts for retryable processing failures.

- Intermediate attempt failures are logged as `warn`.
- Final failure is logged as `error`.
- Final failure stores a `media_artifacts` row with
  `artifact_status = 'failed'` and a short `error_text`.
- Existing retention rules apply to failed artifacts.

Non-retryable cases such as unsupported media, missing provider configuration,
or file size limits can fail immediately.

Flows that require media (`answer` and `decide`) stop when required media failed.
They do not continue without media context.

## Admin Notifications

Add a general admin notification mechanism.

- `TELEGRAM_ADMIN_ID` is the private chat target.
- Wrap the logger with a notifying layer.
- Every `warn` and `error` is duplicated to the admin via Telegram private
  message.
- Message format is short:
  - `WARN: event`
  - `ERROR: event: errorMessage`
- Do not include payload details, stack traces, raw provider responses, IDs, or
  other structured fields in the private message.
- Do not dedupe or rate-limit admin messages.
- Failure to send an admin notification must not affect the main flow and must
  not recurse through the notifying logger.

## Data Model

Add:

- `messages.media_group_id TEXT`
- `mediaGroupId` on `NormalizedMessage`
- `mediaGroupId` on `StoredMessage`

Reuse `media_artifacts` for success and failure rows.

No job table is added in this version.

## Testing

Add or update tests for:

- Telegram normalization of `media_group_id`.
- Auto-read starts for supported media in an authorized chat without a command.
- Album handling skips video and processes only the first image for the group.
- In-flight deduplication shares one processing promise.
- `answer` waits for in-flight media and does not call the LLM after failed
  required media.
- `decide` waits for context media and does not call the LLM after failed
  required media.
- `summarize` waits for already in-flight media but does not start missing reads.
- The user-facing `read` command is no longer recognized.
- The notifying logger sends admin messages for `warn` and `error`, not for
  `debug` or `info`.
- Admin notification send failure does not break normal logging.

## Implementation Notes

This feature changes bot behavior, context-building, and reply policy. Before
implementation, apply the repository bot-behavior approval gate:

- list affected files;
- describe runtime behavior changes;
- describe tests and eval updates;
- proceed only after explicit approval.
