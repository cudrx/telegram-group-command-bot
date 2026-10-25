# Architecture

## Scope

The project is a single Telegram bot process using `grammY` long polling, a local SQLite database, an OpenAI-compatible LLM client, optional lookup/media/TTS providers, assistant requests triggered by mentions or replies and explicit utility commands. Assistant requests require an explicit username mention or a reply to this bot. The automatic trigger outside assistant requests and commands is media expansion for supported Reddit image/gallery/video post links, Instagram Reel links, YouTube Shorts links, and TikTok video links.

The bot responds to these commands:

- `/translate`
- `/read`
- `/transcribe`
- `/meme`
- `/sex`

Explicit bot username mentions and replies to messages from this bot start an assistant reply in configured chats with `features.assistant` enabled and in the operator private chat. Ordinary messages, replies to other participants without a mention, unauthorized chats, and requests from link-only private users do not start an assistant reply. Retired `/answer`, `/summarize`, and `/decide` commands are ignored. Supported Reddit, Instagram Reel, and YouTube Shorts links in authorized chats start a local media flow without the LLM. Link-only users from `linkUserIds` in `telegram-access-config.json` can use only the direct-link flow.

## Invariants

- Access checks run at the application layer before `ChatOrchestrator` and before SQLite writes.
- The message log in `messages` is the main source of truth.
- Assistant candidates can include previous messages from this bot, especially explicit reply ancestors. They are fallible conversation history, never authoritative facts. Utility translation retains its existing neighboring-human context.
- Messages from other bots are stored and can be explicit assistant/translation reply targets or ancestors. Unrelated other-bot messages are excluded from assistant candidate scans.
- Lookup context is added as untrusted evidence, not as instructions.
- Media recognition results are stored as TTL artifacts; source files are temporary.
- `/meme` and `/sex` keep downloaded Reddit media only in a temporary directory until Telegram dispatch completes; anti-repeat state stores post metadata.
- Direct Reddit media links use the same temporary download/dispatch/cleanup approach, store sent Reddit posts in `meme_posts`, and try to delete the source link message after successful dispatch. Direct Instagram Reels, YouTube Shorts, and TikTok videos use the same temporary media flow but are stored only as regular bot media messages, without `meme_posts` rows. In groups and supergroups, direct-media captions credit the sender because the original link message is deleted; private-chat captions remain unchanged. Delete failures are logged.
- Heavy video jobs run through an in-process queue with bounded global concurrency and per-chat concurrency so one chat cannot occupy all video slots.
- Instagram source access can enter a persistent blocked state in SQLite after auth/rate-limit style `yt-dlp` failures. Blocked Instagram jobs do not start again until the cookie file changes on disk.
- TTS does not decide reply content: text is generated or read from the replied-to message first, then a local policy decides whether voice can be sent. Local usage/fallback messages are always sent as text.
- `/transcribe` is an explicit local command for Telegram video messages. It downloads the replied-to Telegram video, extracts audio with `ffmpeg`, transcribes that temporary audio file through the configured speech-to-text provider, replies with text, and does not write a media artifact.

## Component Map

### `src/index.ts`

Loads the environment and starts the application lifecycle.

### `src/app.ts`

Application assembly:

- opens SQLite;
- creates the logger and admin notifier;
- creates the `Bot`;
- loads bot metadata;
- creates LLM, media, lookup, and TTS providers;
- creates Telegram message dispatchers;
- builds `ChatOrchestrator`;
- registers Telegram middleware, error handling, and message handling;
- registers a separate edited-message handler;
- manages startup cleanup, deploy announcements, polling, and shutdown.

Assembly helpers live in:

- `src/app/access-policy.ts`
- `src/app/database-cleanup.ts`
- `src/app/providers.ts`
- `src/app/telegram-dispatchers.ts`

### `src/config`

Configuration is split into two layers:

- `src/config/env/` reads the environment, validates deploy-specific values and secrets, and applies defaults.
- Telegram chat access policy is loaded from the JSON file at `TELEGRAM_CHAT_CONFIG_PATH`. Each chat policy has a `commands` object for slash-command gating, a `features` object for non-command capabilities such as `assistant`, `direct_links`, and `deploy_announcements`, and a `reddit_sources` object for chat-specific `/meme` and `/sex` subreddit lists.
- Global operator access settings are loaded from the JSON file at `TELEGRAM_ACCESS_CONFIG_PATH`.
- `src/config/runtime/` stores non-secret runtime defaults: assistant settings (`answer`) and utility settings (`read`, `meme`, `sex`), external provider settings, and storage settings.
- `src/locales/locale.ts` is the active localization module. Runtime code imports localized user-facing text and language-specific patterns from this file through neutral `text` and `patterns` exports, so switching the bot language is a file replacement/edit rather than a sweep through action code.

Values that differ between environments go through the env schema. Values that describe local bot policy or provider contracts live in runtime config and are imported directly by consumers.

### `src/transport`

Telegram message normalization:

- takes the raw `grammY` context;
- builds a local `NormalizedMessage`;
- extracts text, caption, entities, reply snapshot, and media snapshot.

### `src/domain`

Shared domain types for messages, chats, intents, stored messages, and media snapshots. Commands are registered by action modules.

### `src/app/actions`

Modular command layer:

- each command lives in `src/app/actions/<name>/`;
- the command folder's `index.ts` exports a `ChatAction` with command metadata and a handler;
- `registry.ts` builds command lookup from action metadata, including Telegram bot suffix handling and access mode checks;
- `shared/` contains stable helpers shared by action flows;
- static prompt files live in `llm/`.

### `src/app/chat-orchestrator`

Command-flow orchestrator:

- stores the incoming message;
- starts auto-read for supported media;
- asks the action registry to resolve a command;
- builds a shared request for the resolved action;
- runs `action.handle(...)` for utility commands;
- routes explicit bot mentions and replies to this bot through the shared assistant reply job when enabled;
- otherwise preserves the direct-media/ignore flow.

`index.ts` accepts normalized incoming messages. `reply-job.ts` manages LLM reply job execution, and `reply-generation.ts` builds LLM context and calls the model. Topical helper modules live in `src/app/chat-orchestrator/helpers/`.

### `src/database`

SQLite layer:

- schema and migrations;
- `chats`;
- `messages`;
- `media_artifacts`;
- `app_state`;
- `meme_posts`;
- `source_states`;
- stale-data cleanup, including legacy cleanup for the old `news_posts` table if it still exists in an existing database.

### `src/llm`

LLM layer:

- prompt file registry;
- one assistant behavior policy for answers, explanations, summaries, and disputes; retired summary/dispute policies and fixed output-section checks are removed;
- prompt assembly and sanitization;
- assistant context resolution and research routing in the first completion;
- OpenAI-compatible client;
- retries, timeouts, and logging;
- deploy announcement formatting;
- reply generation.

Static prompt text lives in `llm/`. Assistant and utility prompts receive the current Moscow date and time in plain text. Transcript rows include message IDs, authors, timestamps, and explicit reply IDs. The current user message is the request, and an explicit reply is a separate target. Truncation metadata indicates incomplete candidate history. Assistant instructions and JSON contracts are sent as system data; conversation and web evidence are isolated in user data.

### `src/media`

Providers and Telegram media support:

- Telegram media metadata and file download;
- Gladia transcription;
- Cloudflare Vision;
- OCR.space;
- artifact normalization types.

### `src/tts`

Outbound voice:

- speech cleanup;
- local voice policy;
- Yandex SpeechKit provider.

## Main Message Flow

1. `grammY` receives a message, normalizes Telegram text/caption and entity offsets, and checks access before persistence.
2. `ChatOrchestrator` saves the update in SQLite; duplicate message IDs exit before any new job. Existing media auto-read starts when supported.
3. The action registry resolves utility commands and applies per-chat command gating. Leading slash commands never trigger an assistant mention embedded in their arguments.
4. An explicit username mention or a reply to this bot from a human in an assistant-enabled chat, or the operator private chat, starts the shared `answer` reply job. Bare mentions work; replies to other participants without a mention stay silent. Link-only users cannot start this flow.
5. Without a handled command or assistant request, supported direct media links use the existing local flow.
6. `buildReplyContext` delegates assistant candidate retrieval to `buildAssistantContext`. It uses a bounded recent scan, predecessors of an old reply target, lexical/author/recency hints, and stored explicit reply ancestors. Queries are scoped to the current chat and messages before the triggering update. Telegram reply snapshots can supply missing targets.
7. Target media is recognized using the existing pipeline. Neighboring recognition is never awaited or started on demand. Cached OCR, description, interpretation, and transcript evidence enrich only supplied candidates. Missing recognition is labeled; interpretation is explicitly unverified. History is fitted once after enrichment, preserving retrieval priorities and the space left by mandatory prompt content.
8. The first `generateAnswer` completion resolves the relevant candidate IDs and returns `direct`, `clarify`, or `research`. Direct answers, summaries, dispute assessments, and clarifications complete in this one call. No additional history retrieval is performed.
9. IDs are validated against the current-chat candidate pool. For research, `selectAnswerContext` retains selected original messages, the explicit target, and available explicit parents; unrelated candidates are omitted.
10. Research uses the existing lookup provider for one or two parallel queries. A required lookup failure returns the existing local verification fallback. Successful sources receive request-local IDs and enter the second grounded completion as untrusted evidence.
11. The shared formatter/dispatcher sends the answer and stores it. Existing outbound voice policy applies to assistant answers; local fallbacks remain text.
12. A clarification is an ordinary stored bot reply. A human can reply to it without a mention to continue the conversation and recover its parent request.

No new services, local models, background clustering, or database migration are required. Concurrent distinct requests use their own trigger-bounded context and correlation IDs. Existing per-request provider timeouts and transport retries remain in force.

## Edited Message Flow

1. `grammY` receives `edited_message`.
2. `normalizeEditedTextMessage` extracts the current text or caption and `edit_date`.
3. Access checks run the same way as for regular messages.
4. SQLite updates the existing human row by `chat_id + telegram_message_id`, changing `text` and `edited_at`.
5. Missing rows and bot-message rows are ignored. `ChatOrchestrator` is not called, so edits do not trigger new replies or recalculate existing replies.

## Lookup Flow

- Lookup is available when `TAVILY_API_KEY` is set.
- Assistant context selection, clarification, direct generation, and search routing share the first JSON-mode completion.
- Conversation ambiguity produces a concise clarification; external factual uncertainty may request research. Search is never used to infer missing chat discussions.
- Research permits up to two parallel queries, each capped at three seconds, and then one grounded completion.
- Provider failures preserve the existing verification fallback. The second query is optional when the primary one succeeds.
- Grounded output includes status, evidence quality, outcome, and request-local source IDs; unknown IDs are rejected.
- `/translate` does not use lookup.

## Media Flow

Supported inputs:

- `photo`
- image `document`
- `voice`
- `audio`
- Telegram `video_note`
- Telegram `video` for explicit `/transcribe` only

Behavior:

- provider calls run only when matching keys are present;
- Telegram downloads are bounded by size and time;
- durable results are stored in `media_artifacts`;
- failed auto-read attempts store a failed artifact with a short `errorText`;
- image flow can produce `vision_description`, `ocr_text_ru`, `ocr_text_default`, and `vision_interpretation`;
- audio/video-note flow produces transcript artifacts;
- explicit Telegram video transcription produces a fresh reply and does not store a transcript artifact;
- image/video memes sent by the bot store Telegram media metadata and run through the same auto-read flow;
- media albums are deduplicated by `chatId + mediaGroupId` through short-lived TTL state.

## Command Contracts

### Chat Assistant

- Explicit `@bot_username` mentions, including a bare mention, and replies to messages sent by this bot trigger the assistant. Reply triggers use the Telegram sender ID rather than a display name or forwarded attribution.
- The complete user message defines the task; its reply target provides context without overriding the wording. A target can be a human, this bot, or another bot.
- Answers, summaries, explanations, and dispute assessments use one request contract, with no user-facing mode commands.
- Candidate retrieval is bounded by settings in `src/config/runtime/actions/answer.ts`: recent scan, candidate count, anchor-neighbor count, explicit reply depth, individual text size, selected-ID count, and estimated token budgets.
- Selected messages retain original IDs, authors, times, and explicit links; heuristic relevance does not create durable conversation links. Long message text is explicitly marked when clipped.
- The final prompt budget includes instructions, schema, conversation, target media, and web evidence. Optional history is removed before rejecting an oversized prompt. The local generation fallback applies only when mandatory input alone exceeds the limit. Token estimates are approximate UTF-8-size estimates, not provider token usage.
- Missing subject/context returns `clarify` in the first completion. Users continue by replying to the bot without a mention or mentioning it again. There is no `retrieve_more` route.
- A context-contained answer uses one completion; research uses a second completion after lookup. Existing media recognition and configured transport retries are separate operations.
- `features.assistant` controls access. Legacy `commands.answer`, `commands.summarize`, and `commands.decide` are accepted only for configuration compatibility: their logical OR supplies the flag when it is absent. The old commands are not registered.
- Telegram privacy settings determine which ordinary messages are delivered and therefore available for context; the bot does not fetch inaccessible chat history.

### `/translate`

- Runs as a reply to a target message and always translates into the target language.
- Text after the command is ignored.
- Can translate this bot's own messages; this exception supports the assistant reply -> `/translate` chain.
- Receives up to three recent neighboring human messages as non-output context for resolving ambiguous wording.
- Translates only target-message blocks: text, caption, image OCR text, audio/video-note transcript, or image description.
- Each block is checked locally; blocks that already look like the target language are not sent to the LLM and are not duplicated in the reply.
- If all found blocks already look like the target language, the bot sends a local fallback without the LLM.
- Does not use external lookup.
- The reply labels source blocks with localized labels for message text,
  captions, image OCR text, audio transcripts, and image descriptions.

### `/read`

- Runs as a reply to a text message.
- Does not call the LLM.
- Does not start media recognition.
- Text is cleaned locally, bounded, and checked against cooldown/policy.
- If the TTS provider is missing or fails, the bot sends fallback text.

### `/transcribe`

- Runs only as a reply to Telegram `video` media, including videos sent by this bot.
- Does not call the LLM.
- Ignores text after the command and does not process external links.
- Downloads the Telegram file through `getFile`, extracts audio with `ffmpeg`, and sends the extracted audio to the speech-to-text provider.
- Does not support `voice`, `audio`, or Telegram `video_note`.
- Does not store transcript media artifacts; each invocation performs fresh recognition.
- If Telegram file access, `ffmpeg`, or speech-to-text is unavailable or fails, the bot sends fallback text.

### `/meme` and `/sex`

- Available as a regular chat command.
- Source is Reddit listing JSON from a hardcoded subreddit pool. `/meme` and `/sex` use separate runtime subreddit lists.
- Each run selects up to three subreddits; for each one, Reddit cookies are used to request `/r/<subreddit>/top/.json?t=month&limit=10`.
- Post ids sent in the last 14 days are filtered through `meme_posts`.
- Supports Reddit image URLs and original GIF animations from `i.redd.it`, Reddit galleries from `gallery_data`/`media_metadata`, Reddit video posts from `secure_media.reddit_video`/`media.reddit_video`, and Streamable video links in Reddit posts. Streamable posts are downloaded with yt-dlp using the Reddit permalink.
- NSFW and spoiler posts are allowed and sent with Telegram's spoiler flag. For galleries, the spoiler flag is applied to every album item. External/self/text and unsupported posts are skipped.
- If a candidate fails to download, is too large, or Telegram dispatch fails, the bot logs `WARN` through the logger/admin notifier and tries another shuffled candidate from the same listing, then the next subreddit.
- With `REDDIT_COOKIE_HEADER_PATH` set, Reddit HTTP 401/403 responses raise `RedditCookieHeaderRejectedError` and notify the admin to update the file. Share-link responses are checked after resolving the redirect.
- Original Reddit GIF posts are downloaded directly with the existing 50 MB video-size cap and sent through `sendAnimation`, preserving captions and spoilers. No MP4 variant, yt-dlp, or conversion is required; temporary files are cleaned after dispatch.
- Images and gallery items are downloaded directly into temporary files; Reddit-hosted video is downloaded through `yt-dlp` with cookies. Direct Reddit MP4/fallback URLs are not download paths for video. Temporary files are cleaned up in `finally`.
- Video jobs for `/meme`, `/sex`, and direct supported video links are admitted through the shared queue only after a specific video candidate is chosen. Listing fetches and candidate selection stay outside the queue.
- After successful dispatch, memes store Telegram media metadata; later recognition uses the shared media auto-read flow.
- Captions are built locally from the original title, `r/<subreddit>`, and a linked upvote counter `↑N` that points to the original post.
- The media message is sent without replying to the command.
- If no sendable candidate is found, the bot sends a local fallback without the LLM.

### Direct Media Links

- Works in configured chats that enable `direct_links`, the operator private chat, and link-only private chats for regular non-command messages.
- `ChatOrchestrator` gives command resolution priority in regular modes; for `private_link_sender`, a bot-command entity at the beginning of the message stops processing entirely. If no command is handled and direct links are enabled for that access context, the text is checked for Reddit post URLs, Reddit share links like `/r/<subreddit>/s/<token>`, Instagram Reel URLs, and YouTube Shorts-compatible URLs.
- The resolver fetches Reddit post JSON through `/.json` with cookies and accepts public Reddit image, gallery, Reddit-hosted video, and embedded Streamable video posts. Instagram `/p/<shortcode>/` posts and TikTok Photo Mode links are resolved through `gallery-dl`; image-only results reuse the same image/gallery download and Telegram dispatch path. Mixed Instagram image/video carousels preserve source order and run as one existing Instagram video-queue job; every video item reuses the shared `yt-dlp`/`ffprobe`/`ffmpeg` pipeline before the mixed Telegram media groups are sent. Self/text posts are ignored.
- NSFW and spoiler direct Reddit media are sent with Telegram's spoiler flag; for galleries, the flag is applied to every album item.
- Direct Reddit video links are downloaded through `yt-dlp` using `REDDIT_COOKIES_PATH`. In GitHub production, media commands go through an HTTP adapter to separate video and gallery containers. The video worker includes yt-dlp, ffmpeg, ffprobe, and Node.js for YouTube. The gallery worker resolves gallery JSON. The bot image includes neither Python nor these tools. Native/GitLab runs without worker URLs keep local CLI execution. Reddit `fallback_url` is only a video-post signal, not a download URL.
- Instagram Reels are accepted as `/reel/<shortcode>/` or `/reels/<shortcode>/` URLs and are downloaded through `yt-dlp` with the cookie file from `INSTAGRAM_COOKIES_PATH`. Instagram carousel posts are accepted as `/p/<shortcode>/` and resolved through `gallery-dl` with the same cookies. Direct video URLs discovered inside mixed carousels are passed to the existing `yt-dlp` video pipeline rather than downloaded by separate carousel-specific code. For Reels, `yt-dlp` prefers HLS/m3u8 video + m4a audio before the shared Telegram normalization step.
- TikTok `/photo/<id>` posts and photo-mode short links are resolved through `gallery-dl`. Still images are kept in source order, while the optional MP3 soundtrack is ignored. Ordinary `/video/<id>` links continue through `yt-dlp`.
- If Instagram returns auth/access failures such as login-required or rate-limit responses, the bot stores a blocked source state in SQLite and sends a local unavailable fallback for that request. Later Instagram jobs are rejected before `yt-dlp` starts until the cookie file modification time changes.
- YouTube Shorts are accepted as `youtu.be/<id>`, `youtube.com/watch?v=<id>`, and `youtube.com/shorts/<id>`, normalized to `/shorts/<id>`, and downloaded through `yt-dlp` with the cookie file from `YOUTUBE_COOKIES_PATH`.
- All video-source integrations use the same rule: video from Reddit, Instagram Reels, YouTube Shorts, or similar sites must use `yt-dlp` or an equivalent extractor as the primary download path so video and audio are assembled together; direct MP4 URLs do not bypass that path.
- Image media is downloaded to a temporary file and sent through Telegram `sendPhoto`; galleries are downloaded into temporary files and sent through `sendMediaGroup`; video is downloaded to a temporary MP4 with a 50 MB final cap and a 600-second duration cap, then sent through `sendVideo`. All `yt-dlp` video sources use the same format selector for metadata and download so clearly oversized selected formats above 75 MB can be rejected before starting the download when sizes are known; unknown size metadata is allowed through to the normal download path. If a video job cannot start immediately, the bot sends a short local queue notice before normal video status messages begin. Normalized video is probed before dispatch so Telegram receives `width`, `height`, `duration`, and `supports_streaming` options. Temporary directories are cleaned after dispatch.
- Reddit captions use the same local format as `/meme`: title, `r/<subreddit>`, and linked upvotes.
- Reels/Shorts captions omit description/title and use the short format `<source>: <nickname> · likes: <a href="<source-url>"><N></a>`, matching the Reddit metadata-link style.
- After successful direct Reddit/Reels/Shorts dispatch, the bot calls Telegram `deleteMessage` for the source link message; media is sent without replying to the source message so it does not point back to a deleted message. If Telegram rejects deletion because of permissions, the media message remains.
- If direct video fails only because it exceeds the configured duration or size cap, the bot replies with a local limit-specific fallback and keeps the source link message in place. Unsupported or unavailable links still exit quietly without calling the LLM.

## Data Model

### `chats`

Stores chat metadata, last message/reply timestamps, and outbound TTS state.

### `messages`

Stores incoming and outgoing messages, `reply_to` relationships, sender metadata, bot flag, `output_mode`, and `edited_at` for edited incoming messages.

### `media_artifacts`

Stores normalized provider artifacts, raw response JSON, source metadata, status, error text, and TTL.

### `meme_posts`

Stores anti-repeat history for `/meme` and sent direct Reddit media links: `chat_id`, Reddit post id, subreddit, Telegram message id, title, permalink, media kind, primary media URL, upvotes, and sent timestamp. For galleries, primary media URL is stored as `NULL`. Cleanup deletes rows older than `memeHistoryRetentionDays`.

### `source_states`

Stores persistent runtime state for fragile external sources. The first current use is Instagram video access: after auth/rate-limit style `yt-dlp` failures the bot stores a blocked state plus the cookie file modification time seen at block time, then re-allows Instagram only after the cookie file changes.

### `app_state`

Small runtime key-value state.
- Deploy announcements are formatted once per new deploy `sha` and sent to every configured chat where `features.deploy_announcements` is enabled. Deploy metadata includes commit subjects, changed file paths, a short product overview extracted from README, and a size-limited diff of user-facing documentation. The formatter treats all inputs as factual source material, describes their user-visible meaning in idiomatic Russian instead of translating literally, and emits Telegram-compatible HTML without Markdown. When no concrete user-visible effect is supported, it still produces a neutral internal-improvements announcement without inventing specifics. SQLite stores one shared `last_announced_deploy_sha`, so the same deploy is not reformatted or resent after a successful announce cycle.

## Production Containers

GitHub production uses one K3s Deployment with one Pod and three containers:
`bot`, `video`, and `gallery`. The containers are colocated because the pipeline
shares media files. HTTP runs on loopback ports 8081 and 8082; no Kubernetes
Service, Ingress, or public application port is needed for long polling.

The bot creates per-operation temporary directories under `TMPDIR=/media`.
All containers mount the same disk-backed `emptyDir` there. It survives an
individual container restart but is discarded with the Pod. The `bot-data`
PVC stores SQLite, cookies, and chat/access JSON configuration. Workers mount
it read-only and copy cookie files to private per-job temporary files, so
extractors cannot modify the operator's cookies or trigger spurious source
unlocking. Cookie paths must resolve inside `/app/data`. If a yt-dlp cookie
file is absent, the worker uses a private empty jar instead of rejecting the
request. Existing files remain unchanged.

The transport exposes POST `/jobs`, GET `/jobs/<id>`, DELETE `/jobs/<id>`, and
GET `/health`. Operations cover metadata, download, probe, normalization,
audio extraction, and gallery resolution. Job state is in memory; there is no
broker or durable retry queue. Up to four CLI processes can run per worker,
and the bot retains its existing video and normalization queues. A request's
deadline covers submission and polling; timeout, cancellation, and worker
shutdown kill the process group including ffmpeg descendants. Lost jobs fail
through existing local fallbacks; the bot never retries them using local CLI.
Finished results expire after a minute and are deleted when consumed. HTTP
request bodies use streaming UTF-8 decoding so characters split across chunks
reach the CLI intact.

`replicas: 1` and Deployment strategy `Recreate` prevent overlapping bot
instances during rollout. A brief deployment interruption is expected. All
containers run as UID/GID 1000 with privilege escalation disabled and Linux
capabilities dropped. Startup/readiness/liveness probes check local process
health, not external providers. Before announcements and polling, the bot
waits for both media health endpoints, with a 120-second startup deadline.
CI exports each published image digest from Bake metadata, and both smoke
checks and Deployment use those digests. The source commit is a Pod-template
annotation (`telegram-bot/commit`), preserved by rollback. A metadata ConfigMap
named by commit and content hash is part of the Pod revision, so rollout undo
restores all three images and announcements together. SQLite data is not
rolled back by a Deployment rollback.

GitHub infrastructure files are in `.github/`, with only the mandatory
`workflows/` subdirectory. GitLab infrastructure is in `.gitlab/`, retaining
its existing build targets, registry, and release behavior. `.gitlab-ci.yml`
remains the GitLab entrypoint; the two build configurations are independent.
