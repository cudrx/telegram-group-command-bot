# Architecture

## Modules

| Path | Responsibility |
| --- | --- |
| `src/app.ts` | Telegram polling, providers, handlers, and lifecycle. |
| `src/app/chat-orchestrator/` | Message persistence and command, assistant, and media jobs. |
| `src/app/actions/` | Utility commands and media downloaders. |
| `src/llm/`, `llm/` | API client, prompt assembly, templates, and response validation. |
| `src/database/` | SQLite schema, migrations, queries, and retention. |
| `src/media/` | Recognition providers and HTTP transport to media workers. |
| `src/tts/` | Speech cleanup, voice reply selection, and SpeechKit. |
| `src/config/` | Environment/JSON validation and runtime defaults. |
| `src/locales/locale.ts` | User-facing text and language patterns. |

## Message Flow

`app.ts` checks access before passing messages to the orchestrator:

1. Save the message; stop on duplicates. Start supported media recognition.
2. Run an enabled utility command if present.
3. Otherwise, answer a mention or a human reply to the bot when the assistant
   is enabled. A leading slash command suppresses this trigger.
4. Otherwise, expand a supported media link when enabled.
5. Otherwise, consider a spontaneous reply.

Edits update stored text and `edited_at` without starting a new job.
Access rules and commands are described in the [README](../README.md#usage).

## Assistant

[assistant-context.ts](../src/app/assistant-context.ts) selects messages from
the same chat using reply ancestry, word overlap, authors, and recency. The
request and its explicit reply target are preserved when fitting the prompt
budget. Context limits are in [answer.ts](../src/config/runtime/actions/answer.ts).

An answer has two JSON-mode LLM stages:

1. The planner groups discussions, selects messages, and chooses `direct`,
   `clarify`, or `research`.
2. The generator produces the answer or clarification. `research` runs web
   searches between the two stages and supplies their results to the generator.

The discussion graph exists for that request only. Model-generated links are
validated separately from Telegram reply links. Spontaneous bot messages carry
`generationKind=spontaneous_markov_llm` into context so their origin is explicit.
Prompts use Moscow time. Response schemas and the corrective retry are in
[answer.ts](../src/llm/openai-compatible-client/answer.ts).

Search uses DeepSeek when configured, with Tavily as fallback. Failure to
complete required research produces a local error reply. Provider settings
are in [development](development.md#providers).

## Media

| Source | Extraction |
| --- | --- |
| Reddit | yt-dlp for posts/share links; saved post JSON resolves images and galleries. |
| Instagram | yt-dlp for Reels; gallery-dl for posts and mixed carousels. |
| YouTube | yt-dlp for short/watch/share URLs, with Node.js for challenges. |
| TikTok | yt-dlp for video; gallery-dl for photo posts. |

Video processing uses metadata lookup, download, ffprobe, and ffmpeg conversion
to H.264/AAC MP4. The bot limits concurrent video jobs and serializes conversion.
Limits and timeouts are in
[reddit-media.ts](../src/config/runtime/actions/reddit-media.ts).

Photo/image recognition uses Cloudflare Vision and OCR.space; voice/audio
recognition and video transcription use Gladia. Recognition results are cached
in `media_artifacts`. Telegram videos are transcribed through `/transcribe`.
Short assistant answers can be sent as voice according to
[outbound-policy.ts](../src/tts/outbound-policy.ts).

## Spontaneous Messages

[SpontaneousMessages](../src/app/spontaneous/index.ts) builds a word-chain draft
from this chat's human messages, then makes one LLM call to adapt it or skip.
Attempts are reserved in `app_state` before generation; failures consume them.
Foreground jobs cancel pending sends. New messages, edits, or recent bot output
can also suppress delivery. Policy settings are in
[development](development.md#spontaneous-messages).

## Storage

| Table | Data |
| --- | --- |
| `chats` | Chat metadata and reply/voice state. |
| `messages` | Messages, authors, reply links, edits, and media snapshots. |
| `media_artifacts` | Recognition results and expiry. |
| `meme_posts` | Per-chat Reddit send history. |
| `source_states` | Instagram access lock and cookie modification time. |
| `app_state` | Announcement SHA and spontaneous attempt history. |

SQLite migrations run on open. Cleanup runs at startup and daily: messages and
recognition artifacts are retained for seven days, Reddit history for 14 days.
Defaults are in [storage.ts](../src/config/runtime/storage.ts) and
[reddit-media.ts](../src/config/runtime/actions/reddit-media.ts).

Warnings/errors are sent to the operator. Deploy announcements use commit
metadata and go to chats with `features.deploy_announcements`; the announced
SHA is stored in SQLite.

## Containers

`bot` handles Telegram and SQLite; `video` runs yt-dlp/ffmpeg; `gallery` runs
gallery-dl. Workers expose `/health` and asynchronous `/jobs` endpoints on the
private Compose network. Jobs are held in memory; timeout, cancellation, and
shutdown terminate their subprocesses.

All containers run as UID/GID 1000. Persistent files use `/app/data`, mounted
read-only in workers. Announcement metadata is mounted at `/app/deploy`.
`/media` is shared temporary storage. Workers copy cookies into private per-job
files and remove them afterward.

The bot waits for both workers before polling. Its `/health` returns 503 before
the first successful `getUpdates`, after polling stops, or after 15 minutes
without a successful poll. Empty responses count as success; the grace period
allows long media handlers. See [operations](development.md#production).
