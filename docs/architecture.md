# Architecture

## Scope

The project is a single Telegram bot process using `grammY` long polling, a local SQLite database, an OpenAI-compatible LLM client, optional lookup/media/TTS providers, and explicit command flows. The only automatic trigger outside commands is media expansion for supported Reddit image/gallery/video post links, Instagram Reel links, and YouTube Shorts links.

The bot responds to these commands:

- `/summarize`
- `/decide`
- `/answer`
- `/translate`
- `/read`
- `/transcribe`
- `/meme`
- `/sex`
- `/publish`

Regular bot mentions, regular private-chat text, unauthorized chats, and private messages from users other than the admin or link-only users do not start a reply flow. Supported Reddit, Instagram Reel, and YouTube Shorts links in authorized chats start a local media flow without the LLM. Link-only users from `TELEGRAM_LINK_USER_IDS` can use only the direct-link flow.

## Invariants

- Access checks run at the application layer before `ChatOrchestrator` and before SQLite writes.
- The message log in `messages` is the main source of truth.
- Prompt context excludes previous messages from this bot.
- Messages from other bots are stored and can be reply anchors for `/answer` and `/translate`, but they are excluded from recent human-message context.
- Lookup context is added as untrusted evidence, not as instructions.
- Media recognition results are stored as TTL artifacts; source files are temporary.
- `/meme` and `/sex` keep downloaded Reddit media only in a temporary directory until Telegram dispatch completes; anti-repeat state stores post metadata.
- Direct Reddit media links use the same temporary download/dispatch/cleanup approach, store sent Reddit posts in `meme_posts`, and try to delete the source link message after successful dispatch. Direct Instagram Reels and YouTube Shorts use the same temporary media flow but are stored only as regular bot media messages, without `meme_posts` rows. Delete failures are logged.
- `/publish` is available only in the admin private chat and copies messages into `TELEGRAM_CHAT_ID` through Telegram `copyMessage`/`copyMessages`, preserving content without source-author attribution.
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
- `src/config/runtime/` stores non-secret runtime defaults: action settings (`answer`, `read`, `meme`, `sex`, `summarize`, `decide`), external provider settings, and storage settings.
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
- runs `action.handle(...)`;
- ignores the message when no action is resolved.

`index.ts` accepts normalized incoming messages. `reply-job.ts` manages LLM reply job execution, and `reply-generation.ts` builds LLM context and calls the model. Topical helper modules live in `src/app/chat-orchestrator/helpers/`.

### `src/database`

SQLite layer:

- schema and migrations;
- `chats`;
- `messages`;
- `media_artifacts`;
- `app_state`;
- `meme_posts`;
- stale-data cleanup, including legacy cleanup for the old `news_posts` table if it still exists in an existing database.

### `src/llm`

LLM layer:

- prompt file registry;
- prompt assembly and sanitization;
- lookup planner;
- OpenAI-compatible client;
- retries, timeouts, and logging;
- deploy announcement formatting;
- reply generation.

Static prompt text lives in `llm/`. The shared reply shell also receives `CURRENT_DATETIME` with current Moscow date and time in plain text so all reply intents resolve relative dates consistently.

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

1. `grammY` receives a message update.
2. `normalizeTextMessage` builds a `NormalizedMessage`.
3. The application access policy determines `authorizedMode` or rejects the update.
4. `ChatOrchestrator` stores the message in SQLite.
5. If the message has a supported media snapshot, the auto-read coordinator starts.
6. The action registry resolves a command from registered action metadata.
7. When no action is resolved, the flow ends.
8. `ChatOrchestrator` builds a request and calls `action.handle(...)`.
9. `/read` runs a local TTS flow without the LLM.
10. `/meme` and `/sex` run a separate flow that selects a Reddit top-week post, downloads image/video media, and sends it with a locally formatted caption.
11. `/summarize`, `/decide`, `/answer`, and `/translate` use the shared LLM reply job: context is assembled, current Moscow date/time is added, lookup/media context is added when needed, and the LLM is called.
12. The reply is formatted for Telegram HTML.
13. `/answer` may be sent as voice when it passes the local TTS policy; local placeholder and fallback replies are text-only.
14. The outgoing bot message is stored in SQLite with `output_mode`.

## Edited Message Flow

1. `grammY` receives `edited_message`.
2. `normalizeEditedTextMessage` extracts the current text or caption and `edit_date`.
3. Access checks run the same way as for regular messages.
4. SQLite updates the existing human row by `chat_id + telegram_message_id`, changing `text` and `edited_at`.
5. Missing rows and bot-message rows are ignored. `ChatOrchestrator` is not called, so edits do not trigger new replies or recalculate existing replies.

## Lookup Flow

- Lookup is available when `TAVILY_API_KEY` is set.
- The LLM planner decides whether lookup is useful for `/decide` or `/answer`; `/translate` does not use lookup.
- The provider has timeouts, maximum query count, and maximum result count.
- Without a provider, or after fallback, replies are based only on chat context.
- Lookup results enter the prompt as a separate external-evidence block.

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

### `/answer`

- Uses the replied-to target message; without a reply, the target is the latest message before the command.
- Text after the command is ignored.
- The reply anchor can be a human message or another bot's message, but not this bot's own message.
- Can use lookup and media context from the target message.

### `/translate`

- Runs as a reply to a target message and always translates into the target language.
- Text after the command is ignored.
- Can translate this bot's own messages; this exception supports the `/answer` -> `/translate` chain.
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

### `/publish`

- Runs only in the admin private chat.
- Copies the replied-to message into `TELEGRAM_CHAT_ID`; without a reply, it copies the latest message before the command.
- Uses Telegram `copyMessage`, so text, media, and captions are copied without rebuilding and without a source-message link.
- If the target message belongs to a stored `media_group_id`, it uses `copyMessages` with sorted message ids and preserves album grouping.
- If Telegram cannot copy the target message or message type, the bot sends a local hint in the admin private chat.

### `/summarize`

- Summarizes recent human messages.
- Does not use the internet.
- Excludes previous bot messages and other bots' messages from recent human-message context.

### `/decide`

- Judges a dispute in the visible recent-message context.
- With lookup configured, it can verify facts, freshness, links, or external entities.
- Should say when context or criteria are insufficient.

### `/meme` and `/sex`

- Available as a regular chat command.
- Source is Reddit listing JSON from a hardcoded subreddit pool. `/meme` and `/sex` use separate runtime subreddit lists.
- Each run selects up to three subreddits; for each one, Reddit cookies are used to request `/r/<subreddit>/top/.json?t=week&limit=10`.
- Post ids sent in the last 14 days are filtered through `meme_posts`.
- Supports Reddit image URLs from `i.redd.it`, Reddit galleries from `gallery_data`/`media_metadata`, and Reddit video posts from `secure_media.reddit_video`/`media.reddit_video`.
- NSFW and spoiler posts are allowed and sent with Telegram's spoiler flag. For galleries, the spoiler flag is applied to every album item. External/self/text and unsupported posts are skipped.
- If a candidate fails to download, is too large, or Telegram dispatch fails, the bot logs `WARN` through the logger/admin notifier and tries another shuffled candidate from the same listing, then the next subreddit.
- Images and gallery items are downloaded directly into temporary files; Reddit-hosted video is downloaded through `yt-dlp` with cookies. Direct Reddit MP4/fallback URLs are not download paths for video. Temporary files are cleaned up in `finally`.
- After successful dispatch, memes store Telegram media metadata; later recognition uses the shared media auto-read flow.
- Captions are built locally from the original title, `r/<subreddit>`, and a linked upvote counter `↑N` that points to the original post.
- The media message is sent without replying to the command.
- If no sendable candidate is found, the bot sends a local fallback without the LLM.

### Direct Media Links

- Works in the authorized work chat, admin private chat, and link-only private chats for regular non-command messages.
- `ChatOrchestrator` gives command resolution priority in regular modes; for `private_link_sender`, a bot-command entity at the beginning of the message stops processing entirely. If no command is handled, the text is checked for Reddit post URLs, Reddit share links like `/r/<subreddit>/s/<token>`, Instagram Reel URLs, and YouTube Shorts-compatible URLs.
- The resolver fetches Reddit post JSON through `/.json` with cookies and accepts public Reddit image, gallery, and Reddit-hosted video posts. Self/text posts are recognized as unsupported and ignored.
- NSFW and spoiler direct Reddit media are sent with Telegram's spoiler flag; for galleries, the flag is applied to every album item.
- Direct Reddit video links are downloaded through standalone `yt-dlp` available on `PATH` from `/usr/local/bin/yt-dlp`, using the cookie file from `REDDIT_COOKIES_PATH`. The runtime image does not contain Python, `ffmpeg`, or `ffprobe`; deploy compose mounts official standalone `yt-dlp` and static `ffmpeg`/`ffprobe` binaries from `data/bin` into `/usr/local/bin`. Reddit `fallback_url` is used only as a video-post signal, not as a download URL.
- Instagram Reels are accepted only as `/reel/<shortcode>/` or `/reels/<shortcode>/` URLs and are downloaded through `yt-dlp` with the cookie file from `INSTAGRAM_COOKIES_PATH`. For Reels, `yt-dlp` prefers HLS/m3u8 video + m4a audio before the shared Telegram normalization step.
- YouTube Shorts are accepted as `youtu.be/<id>`, `youtube.com/watch?v=<id>`, and `youtube.com/shorts/<id>`, normalized to `/shorts/<id>`, and downloaded through `yt-dlp` with the cookie file from `YOUTUBE_COOKIES_PATH`.
- All video-source integrations use the same rule: video from Reddit, Instagram Reels, YouTube Shorts, or similar sites must use `yt-dlp` or an equivalent extractor as the primary download path so video and audio are assembled together; direct MP4 URLs do not bypass that path.
- Image media is downloaded to a temporary file and sent through Telegram `sendPhoto`; galleries are downloaded into temporary files and sent through `sendMediaGroup`; video is downloaded to a temporary MP4 with a separate size limit and sent through `sendVideo`. Normalized video is probed before dispatch so Telegram receives `width`, `height`, `duration`, and `supports_streaming` options. Temporary directories are cleaned after dispatch.
- Reddit captions use the same local format as `/meme`: title, `r/<subreddit>`, and linked upvotes.
- Reels/Shorts captions omit description/title and use the short format `<source>: <nickname> · likes: <a href="<source-url>"><N></a>`, matching the Reddit metadata-link style.
- After successful direct Reddit/Reels/Shorts dispatch, the bot calls Telegram `deleteMessage` for the source link message; media is sent without replying to the source message so it does not point back to a deleted message. If Telegram rejects deletion because of permissions, the media message remains.
- The flow does not call the LLM and does not send text fallback for unsupported or unavailable links.

## Deploy Announcement Flow

1. The deploy workflow writes metadata to server persistent storage.
2. The container sees the file as `/app/data/deploy-metadata.json`.
3. Application startup skips the announcement when metadata is missing, invalid, or already announced.
4. The new `sha` is formatted through the LLM.
5. The bot sends a Telegram HTML announcement to `TELEGRAM_CHAT_ID`.
6. After successful dispatch, the `sha` is stored in `app_state`.

Announcement errors do not block long polling.

## Data Model

### `chats`

Stores chat metadata, last message/reply timestamps, and outbound TTS state.

### `messages`

Stores incoming and outgoing messages, `reply_to` relationships, sender metadata, bot flag, `output_mode`, and `edited_at` for edited incoming messages.

### `media_artifacts`

Stores normalized provider artifacts, raw response JSON, source metadata, status, error text, and TTL.

### `meme_posts`

Stores anti-repeat history for `/meme` and sent direct Reddit media links: `chat_id`, Reddit post id, subreddit, Telegram message id, title, permalink, media kind, primary media URL, upvotes, and sent timestamp. For galleries, primary media URL is stored as `NULL`. Cleanup deletes rows older than `memeHistoryRetentionDays`.

### `app_state`

Small runtime key-value state, such as `last_announced_deploy_sha`.
