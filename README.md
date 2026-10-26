# Telegram Group Command Bot

A Telegram group assistant built with TypeScript, grammY, SQLite, and
OpenAI-compatible LLM providers.

- Answers mentions and replies using stored chat context; can search the web.
- Translates messages, reads text aloud, and transcribes Telegram videos.
- Sends Reddit media through `/meme` and `/sex`.
- Expands Reddit, Instagram, YouTube, and TikTok links without the LLM.
- Recognizes images and audio when the corresponding providers are configured.

## Quick Start

Requires Node.js 24, npm 11+, a Telegram bot token, and an LLM API key.

```bash
npm ci
mkdir -p data
cp config/examples/.env.example .env
cp config/examples/telegram-chat-config.example.json data/telegram-chat-config.json
cp config/examples/telegram-access-config.example.json data/telegram-access-config.json
```

Edit `.env` and both JSON files before starting. Replace required placeholders;
remove or comment out unused provider keys. Set real Telegram IDs and enable
the commands and features you need. Enabled `meme`/`sex` commands require
non-empty matching `reddit_sources` lists.

```bash
npm run migrate
npm run dev
```

Media downloads need local CLI tools or the video/gallery workers. To run all
three containers locally with those tools included:

```bash
docker compose -f .github/compose.yml up -d --build
```

The mounted `data/` directory must be writable by UID/GID 1000.
See [development](docs/development.md) for provider settings, cookies, and checks.

## Usage and Access

In configured groups with `features.assistant` enabled, mention the actual bot
username (`@bot_username объясни это`) or reply to a message from the bot.
A bare mention also works. Reply to a participant's message with a mention
to make it the target. Ordinary messages are stored for context without
triggering an assistant reply; edits update stored text without a new reply.

To receive ordinary group messages, disable BotFather privacy mode or give
the bot the necessary administrator access. Context only includes messages
Telegram delivers to the bot.

Utility commands are enabled per group:

| Command       | Action                                                                                 |
| ------------- | -------------------------------------------------------------------------------------- |
| `/translate`  | Translate the replied-to text or recognized media into the configured target language. |
| `/read`       | Speak the replied-to text using Yandex SpeechKit.                                      |
| `/transcribe` | Transcribe the replied-to Telegram video using Gladia.                                 |
| `/meme`       | Send fresh Reddit media from the chat's meme sources.                                  |
| `/sex`        | Send Reddit media from a separate source list, with spoilers.                          |

`features.direct_links` enables media expansion; `features.deploy_announcements`
enables update notices. Direct media posts are sent without a reply; after
success, the bot tries to delete the original link and credits its sender in groups.

The operator's private chat supports the assistant and direct links. Users in
`linkUserIds` can send direct links privately. Utility commands are group-only;
unconfigured groups and other private users are rejected.

## Development and Deployment

- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md): routing, context, media, and storage.
- [Development](docs/development.md): configuration, tests, Docker, and K3s operations.
- [Research](docs/research.md): reading list for conversation evals.

Production uses one K3s Pod with `bot`, `video`, and `gallery` containers.
GitHub Actions deploys non-documentation changes pushed to `main`; PRs run CI.
Deployment credentials and recovery commands are in the development guide.

## License

[MIT](LICENSE).
