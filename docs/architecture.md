# Architecture

## Components

| Path                         | Responsibility                                                             |
| ---------------------------- | -------------------------------------------------------------------------- |
| `src/app.ts`                 | grammY long polling, access checks, providers, dispatchers, and lifecycle. |
| `src/app/chat-orchestrator/` | Persistence, command/assistant/link routing, context, and media jobs.      |
| `src/app/actions/`           | Command registry and utility implementations.                              |
| `src/llm/`, `llm/`           | Provider client, prompt assembly, response validation, and static prompts. |
| `src/database/`              | SQLite migrations, queries, and retention cleanup.                         |
| `src/media/`                 | Recognition providers, Telegram file access, and CLI worker transport.     |
| `src/tts/`                   | Speech cleanup, voice policy, and Yandex SpeechKit.                        |
| `src/config/env/`            | Environment and JSON access configuration validation.                      |
| `src/config/runtime/`        | Non-secret limits and feature/provider defaults.                           |
| `src/locales/locale.ts`      | User-facing text and language-specific patterns.                           |

## Message Routing

1. Normalize a Telegram message and check access before writing to SQLite.
2. Store the message; stop on duplicates. Start supported media recognition.
3. Resolve a leading utility command and check the chat's command flag.
4. Otherwise, a bot mention or a human reply to this bot starts the assistant
   when enabled. A leading slash command suppresses the assistant trigger.
5. Otherwise, expand a supported link if direct links are enabled.

Configured groups use per-chat command and feature flags. The operator's
private chat allows the assistant and links; `linkUserIds` allow links only.
Utility actions are registered for group mode. Unauthorized updates are rejected.

Edits update existing incoming message text/captions and `edited_at`.
They do not create missing messages or trigger new jobs. Other bots' messages
can be stored and used as explicit targets; unrelated other-bot messages are
excluded from assistant candidate scans.

## Assistant Context and Search

The current message is the request; its explicit reply target supplies context.
Retrieval stays within the chat and preserves message IDs, authors, timestamps,
and reply links. Earlier bot answers remain fallible conversation history.

Current limits in [answer.ts](../src/config/runtime/actions/answer.ts):

- Scan 128 recent messages, add up to 16 predecessors of an old reply target,
  and follow explicit reply ancestry up to 16 links.
- Keep up to 80 candidates, ranked by reply relationships, terms, author, and
  recency. Heuristic relevance does not create stored conversation links.
- Clip individual text at 6,000 characters and mark incomplete context.
- Fit optional history within an estimated 8,000 tokens and a 16,000-token
  total prompt budget. Estimates use UTF-8 size, not provider token usage.
  Drop optional history before rejecting oversized mandatory input.

The first JSON-mode completion selects candidate IDs (at most 64) and returns:

| Route      | Work                                                            |
| ---------- | --------------------------------------------------------------- |
| `direct`   | Answer from available context.                                  |
| `clarify`  | Ask for missing context; the user can reply to the bot.         |
| `research` | Run up to two parallel web queries, then a grounded completion. |

Responses are validated locally. Unknown or cross-chat IDs are rejected.
Research receives selected original messages and available explicit parents;
there is no additional history search after the first decision. Conversation
and web evidence are passed as untrusted data, separate from system instructions.
Prompts include the current Moscow date and time.

DeepSeek Search is primary when its key is available. It reuses `LLM_API_KEY`
only for the official DeepSeek origin; otherwise it needs `DEEPSEEK_API_KEY`.
An error, empty result, or overlong query logs an admin WARN and tries Tavily
once if configured. Tavily can also run alone. Each attempt has its own
`LOOKUP_TIMEOUT_MS`; there are no search retries or full-page Fetch calls.
Failed verification uses a local fallback.

Retired `/answer`, `/summarize`, and `/decide` commands are not registered.
Their legacy config flags only supply `features.assistant` when it is omitted.

## Utility Commands and Recognition

| Command         | Contract                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/translate`    | Requires a reply. Translates target text, captions, OCR, transcripts, or descriptions; uses up to three neighboring human messages as context. Skips blocks already in the target language. No web search. |
| `/read`         | Requires replied-to text. Cleans it locally and applies TTS limits/cooldown. No LLM or recognition call.                                                                                                   |
| `/transcribe`   | Requires a replied-to Telegram video, including one sent by the bot. Downloads it, extracts audio with ffmpeg, and transcribes through Gladia. No LLM or cached transcript artifact.                       |
| `/meme`, `/sex` | Use the chat's `reddit_sources` lists. Try up to three subreddits' top-month listings, filter posts sent in the last 14 days, and try another candidate on failure. No LLM.                                |

Recognition supports photos/image documents and voice/audio/video notes when
provider keys are present. Images use Cloudflare Vision and OCR.space; audio
uses Gladia. Results and failures are TTL artifacts. Albums deduplicate image
recognition by chat and media-group ID. Telegram videos are recognized only
through explicit `/transcribe`.

Reply text is decided before the outbound voice policy runs. Usage messages
and local fallbacks stay text. Missing providers return local fallbacks where
the requested operation requires them.

## Social Media Downloads

| Source    | Supported links and extraction                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reddit    | Post and share links: yt-dlp first; gallery-dl for images, GIFs, and galleries when video extraction fails. |
| Instagram | Reels via yt-dlp; `/p/` galleries via gallery-dl. Mixed carousels retain source order and normalize each video.                                     |
| YouTube   | `youtu.be`, `watch?v=`, and `/shorts/` URLs normalized to Shorts. yt-dlp uses the Node.js runtime for challenges.                                   |
| TikTok    | Videos via yt-dlp; photo-mode links via gallery-dl. Optional gallery soundtrack is ignored.                                                         |

Reddit listings for `/meme` and `/sex` use HTTP and prefer
`REDDIT_COOKIE_HEADER_PATH` over Netscape cookies. HTTP 401/403 with a raw cookie
header notifies the admin to refresh it. Direct links use `REDDIT_COOKIES_PATH`
with yt-dlp/gallery-dl. yt-dlp uses `--impersonate chrome`, which needs its
`curl-cffi` extra. Download failures leave the source link and send an error reply.

Video processing is `yt-dlp metadata → download → ffprobe → ffmpeg → ffprobe`.
Metadata and download use the same format selector. Reject videos over
600 seconds or known selected formats over 75 MB; enforce 50 MB after download
and conversion. Normalize to H.264/AAC MP4 with Telegram dimensions/duration.
Reddit fallback MP4 URLs identify video posts; they do not bypass extraction.

The queue allows two video jobs globally and one per chat; normalization runs
one process at a time. Subprocess timeouts free queue slots on stuck tools.
Instagram auth/rate-limit failures persist a source lock in SQLite; changing
the cookie file's modification time allows a new attempt.

Images, GIFs, galleries, and videos use Telegram's matching media methods.
Temporary files are cleaned after dispatch. Reddit NSFW/spoiler flags are
preserved; video metadata reads them from the post JSON saved by yt-dlp's
`--write-pages`. `/sex` forces spoilers. Successful Reddit sends update `meme_posts`;
other sources are stored as ordinary bot media messages.

Direct expansion sends media without replying, then tries to delete the source
link. Group captions credit the sender. Failed deletion leaves the media sent;
size/duration rejections retain the original link and send a local explanation.

## Storage and Notifications

| Table             | Contents                                                                      |
| ----------------- | ----------------------------------------------------------------------------- |
| `chats`           | Chat metadata and reply/TTS state.                                            |
| `messages`        | Incoming/outgoing messages, senders, reply links, edits, and media snapshots. |
| `media_artifacts` | Recognition results, provider responses, failures, and expiry.                |
| `meme_posts`      | Per-chat Reddit send history for anti-repeat selection.                       |
| `source_states`   | Instagram access lock and cookie modification time.                           |
| `app_state`       | Runtime values, including the last announced deployment SHA.                  |

[Storage defaults](../src/config/runtime/storage.ts) retain messages and media
artifacts for seven days; Reddit history lasts 14 days. Cleanup runs daily.

Every WARN and ERROR is also sent to the operator. Deploy announcements go to
chats with `features.deploy_announcements`; a shared SHA prevents resending a
completed announcement cycle. Inputs include commit subjects, changed paths,
README overview, and bounded documentation diffs.

## Containers and Rollout

GitHub production has one K3s Pod with `bot`, `video`, and `gallery` containers,
all running as UID/GID 1000. Workers listen on Pod loopback ports 8081/8082.
The bot waits up to 120 seconds for them before announcements and polling.

The `bot-data` PVC holds SQLite, JSON config, and cookies. Workers mount it
read-only and copy cookies into per-command temporary directories with file
mode `0600`, removed in `finally`. Missing yt-dlp cookie files start an empty
private jar. Worker cookie paths must resolve within `/app/data`.
A shared `/media` emptyDir holds temporary media and is discarded with the Pod.

Workers expose `/health` and asynchronous `/jobs` endpoints for metadata,
download, probe, normalization, audio extraction, and gallery resolution.
Jobs live in memory, with up to four CLI processes per worker. Timeout,
cancellation, or shutdown kills the process group. HTTP failures do not retry
through local CLI. Native/GitLab runs use local tools when worker URLs are absent.

Deployment uses one replica and `Recreate`, so rollout interrupts service
without overlapping polling bots. Images are pinned by digest. A versioned
metadata ConfigMap and `telegram-bot/commit` annotation belong to the Pod
revision; rollback restores them with all three images, but does not restore
SQLite. See [development](development.md#production-on-k3s) for operations.
