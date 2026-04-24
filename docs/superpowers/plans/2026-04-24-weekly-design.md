# Weekly Recap Design

## Context

The bot is locked to one configured Telegram group chat and one admin private
chat:

- group chat: `TELEGRAM_CHAT_ID`
- admin private chat: `TELEGRAM_ADMIN_ID`

Current chat commands operate on nearby reply context. `/weekly` is different:
it is an admin-triggered publication that summarizes the last seven days of the
configured group chat as a social recap.

Automatic media reading is already implemented. Supported incoming media can
produce durable `media_artifacts`, and existing reply flows can reuse successful
media summaries. `/weekly` should use those cached summaries when available, but
must not start new media recognition work.

The production smoke database in `data/prod-smoke.sqlite` shows that the weekly
input is too large for a raw transcript prompt: about one thousand human
messages, many reply links, and multiple dense activity windows. The feature
therefore needs code-driven event selection before the LLM call.

## Goals

- Add an admin-only `/weekly` command.
- Allow `/weekly` only from `private_admin`.
- Always build the report for the single configured group chat,
  `TELEGRAM_CHAT_ID`.
- Send the final weekly report to `TELEGRAM_CHAT_ID`.
- Do not send a confirmation message to the admin private chat.
- Build the report from the last seven days relative to runtime `now()`.
- Generate a report even when the week has few messages.
- Find important message groups as event candidates before calling the LLM.
- Include cached successful media summaries in event evidence.
- Ignore missing or failed media artifacts as blocking conditions.
- Keep the weekly flow separate from ordinary nearby-context reply flows.

## Non-Goals

- Do not support choosing another chat.
- Do not make `/weekly` work in the group chat.
- Do not add scheduling or automatic weekly posting.
- Do not start or retry media recognition from `/weekly`.
- Do not introduce durable jobs or a queue for weekly generation.
- Do not add participant memory or permanent participant profiles.
- Do not use internet lookup.

## Runtime Behavior

The command flow is:

```text
private_admin /weekly
  -> save incoming admin message
  -> detect weekly admin command
  -> read last 7 days from TELEGRAM_CHAT_ID
  -> build weekly stats
  -> generate event candidates
  -> attach cached successful media summaries
  -> merge, score, and select events
  -> format WeeklyDataset
  -> call weekly LLM prompt
  -> send recap to TELEGRAM_CHAT_ID
  -> save sent bot message as a group chat bot message
```

If the LLM call or Telegram send fails, the bot logs the error and sends no
group message. The existing notifying logger can surface warnings and errors to
the admin.

The admin private command itself receives no success confirmation.

## Why A Separate Weekly Flow

Existing `AssistantIntent` commands use `ReplyContext`: trigger message, optional
reply anchor, and nearby prior messages. That model represents a current local
conversation around a command.

`/weekly` builds a historical dataset from the configured group chat while the
trigger is in the admin private chat. It needs weekly stats, selected event
candidates, participant stats, and media summaries. Treating that as
`ReplyContext` would make the type misleading and would force weekly-specific
data through unrelated reply code.

Use a separate `WeeklyDataset` and weekly generation path instead.

## Data Input

Add a database read method for the configured group chat:

```ts
getMessagesInRange(input: {
  chatId: number;
  fromInclusive: string;
  toExclusive: string;
}): StoredMessage[]
```

The query should:

- filter by `chat_id`;
- filter by `created_at >= fromInclusive` and `created_at < toExclusive`;
- order by `telegram_message_id ASC`;
- return media snapshot fields and `mediaGroupId`;
- allow the caller to filter out bot messages.

The weekly builder excludes bot messages from stats and events. This prevents
previous bot reports, deploy announcements, and assistant replies from becoming
weekly evidence.

## Media Enrichment

For selected or candidate messages with media, use cached successful artifacts
only:

- image preference:
  `vision_interpretation`, `ocr_text_ru`, `ocr_text_default`,
  `vision_description`, `vision_raw`
- audio preference:
  `transcript`

The existing preferred-summary logic in
`src/app/chat-orchestrator/media/cache.ts` should be reused or moved into a
shared module if needed.

Message rendering rules:

- if a successful summary exists, append `[media] <summary>`;
- if no summary exists but caption exists, render media kind and caption;
- if no summary or caption exists, render media kind only;
- failed artifacts do not block the report.

Weekly does not wait for in-flight auto-read tasks and does not start missing
reads. It uses the durable state already available at command time.

## Weekly Event Candidate Model

Use an internal candidate shape similar to:

```ts
type WeeklyEventCandidate = {
  id: string;
  kinds: Array<'burst' | 'reply_hotspot' | 'reply_chain' | 'media_moment'>;
  startAt: string;
  endAt: string;
  messageIds: number[];
  participantIds: number[];
  score: number;
  reasons: string[];
};
```

The name in code can be `WeeklyEventCandidate` or similar. The important
property is that the unit represents a possible event of the week, not just an
arbitrary transcript slice.

## Candidate Generation

### Bursts

Detect dense activity windows:

- window size: 10 minutes;
- threshold: at least 12 human messages;
- threshold: at least 2 participants.

After creating a burst candidate, expand to natural boundaries while the gap
between neighboring messages is at most 5 minutes. Cap large bursts when
formatting evidence rather than at candidate creation.

### Reply Hotspots

Detect messages that received multiple direct replies:

- threshold: at least 3 direct human replies.

Candidate evidence should include:

- the anchor message;
- direct replies;
- a small neighbor context around the anchor and replies, about five messages on
  each side where available.

This catches questions, prompts, jokes, and arguments that caused discussion.

### Reply Chains

Build a graph from `telegram_message_id` to `reply_to_telegram_message_id`.

Create a candidate for connected reply components when:

- component size is at least 4 human messages;
- participant count is at least 2.

This catches dialogue-like events that may be spread out and therefore missed by
burst detection.

### Media Moments

Create media candidates for media messages when:

- a successful cached media summary exists;
- and either the media received replies or nearby activity was dense.

This catches memes, screenshots, voice notes, and other media-centered moments.

## Merge And Dedupe

Candidates should merge when:

- their message id sets overlap;
- or their time windows overlap;
- or the time gap is under 5 minutes and they share at least one participant.

Merged candidates keep all distinct `kinds` and `reasons`, union their message
ids, extend the time range, and recompute score.

This prevents a single busy moment from appearing as separate burst, reply
hotspot, and media events.

## Scoring

Use scoring only to rank candidates, not as a claim of objective importance.

Initial score:

```ts
score =
  messageCount
  + participantCount * 3
  + replyCount * 2
  + maxRepliesToOneMessage * 4
  + mediaSummaryCount * 3
```

Tiny messages may be left in evidence, but the selector can avoid giving too
much weight to events that are mostly very short acknowledgements.

## Selection

Select 6 to 10 events:

- sort merged candidates by score descending;
- select with a soft limit of at most 2 events per calendar day;
- if fewer than 6 events remain, fill by score without the day limit;
- if the week is very quiet, still select whatever exists and generate a report.

Calendar days can use UTC for consistency with stored ISO timestamps. If later
reports need local chat time, add an explicit config rather than guessing.

## Evidence Formatting

Each selected event should be formatted compactly for the LLM:

```text
[EVENT 1]
kinds: burst, reply_hotspot
time: 2026-04-22T18:10:00.000Z..2026-04-22T18:42:00.000Z
score: 58
why_selected:
- high message density
- many replies to one message
participants:
- Name A
- Name B
messages:
- [18:12] Name A: ...
- [18:13] Name B: [media] ...
```

Large events should be trimmed to about 20 to 30 message lines. Prefer:

- anchor or hotspot messages;
- direct replies;
- messages with media summaries;
- first and last few messages;
- a mix of participants.

The formatter must sanitize user text using the existing prompt sanitization
helpers before inserting it into an LLM prompt.

## Weekly Dataset

The LLM input should include:

```text
WEEK_STATS
- period
- total human messages
- participants
- reply messages
- media messages
- media messages with successful summaries
- top active days

PARTICIPANT_STATS
- messages
- replies sent
- replies received
- media sent

SELECTED_EVENTS
- event metadata
- compact evidence messages
```

Stats support observations but selected events are the primary evidence.

## Prompt Contract

Add `llm/reply/weekly.md` with a strict weekly mode prompt.

The prompt should require:

- Russian output;
- Telegram-safe HTML only;
- no unsupported invention;
- no permanent participant profiles;
- no diagnoses or psychological labels;
- roles based only on the selected week;
- mild humor allowed, cruelty avoided;
- compact sections.

Required output shape:

```html
<b>Неделя в чате</b>

• ...

<b>Темы</b>

• ...

<b>Моменты</b>

• ...

<b>Роли недели</b>

• ...

<b>Факты</b>

• ...

<b>Итог</b>
...
```

The prompt should tell the model to rely primarily on `SELECTED_EVENTS` and use
stats only as supporting evidence.

## Component Design

Suggested modules:

- `src/app/weekly/messages.ts`
  Range loading and human-message filtering.
- `src/app/weekly/media.ts`
  Cached media summary lookup and message enrichment.
- `src/app/weekly/events.ts`
  Candidate generation for bursts, reply hotspots, reply chains, and media
  moments.
- `src/app/weekly/select.ts`
  Candidate merge, scoring, day balancing, and selection.
- `src/app/weekly/format.ts`
  Weekly dataset prompt formatting.
- `src/app/weekly/index.ts`
  Weekly service orchestration.
- `src/llm/openai-compatible-client/weekly.ts`
  Weekly-specific LLM call.

The exact file split can be adjusted during implementation, but keep event
detection and prompt formatting testable without Telegram.

## Affected Existing Areas

Expected touched areas:

- `src/domain/models.ts`
- `src/domain/response-policy.ts`
- `src/app.ts`
- `src/app/chat-orchestrator/index.ts`
- `src/app/chat-orchestrator/types.ts`
- `src/database/messages-read.ts`
- `src/database/index.ts`
- `src/llm/openai-compatible-client/*`
- `src/llm/prompt-files.ts`
- `llm/reply/weekly.md`
- `README.md`
- `docs/architecture.md`
- `docs/development.md`

Because this changes bot behavior and prompt behavior, apply the repository
bot-behavior approval gate before implementation.

## Testing

Add focused tests for:

- `/weekly` is recognized only in `private_admin`.
- `/weekly` in the group chat is ignored.
- range message loading by `created_at`.
- burst candidate detection.
- reply hotspot detection.
- reply chain detection.
- media moment detection from cached artifacts.
- merge and dedupe behavior.
- day-balanced selection.
- formatter includes cached media summaries and tolerates missing artifacts.
- weekly orchestration calls the LLM and sends the result to `TELEGRAM_CHAT_ID`.
- weekly orchestration does not send a private admin confirmation.
- LLM failure does not send a group message.

Add a smoke path for `data/prod-smoke.sqlite` that builds the weekly dataset and
prints stats/events without sending Telegram messages. This can be a script or a
test utility, but it should not depend on network access.

## Documentation Updates After Implementation

After implementation, update:

- `README.md` command list and behavior notes;
- `docs/architecture.md` runtime flow and context contract;
- `docs/development.md` local smoke workflow if a script is added.

Also remove or update stale planning details if this plan becomes durable
architecture.
