# Telegram Group Command Bot

Telegram group assistant using TypeScript, grammY, SQLite, and an
OpenAI-compatible LLM API.

- Answers mentions and replies using chat history and web search.
- Translates messages, reads text aloud, and recognizes images and audio.
- Downloads Reddit, Instagram, YouTube, and TikTok media.
- Can send spontaneous messages generated from the group's vocabulary.

## Quick Start

Requires Node.js 24, a Telegram bot token, and an LLM API key.

```bash
npm ci
mkdir -p data media
cp config/examples/.env.example .env
cp config/examples/telegram-chat-config.example.json data/telegram-chat-config.json
cp config/examples/telegram-access-config.example.json data/telegram-access-config.json
```

Set real credentials in `.env`, group IDs in the chat config, and your Telegram
user ID in the access config. Remove unused optional provider keys. Enable the
commands you need; `/meme` and `/sex` require matching `reddit_sources` lists.

```bash
npm run dev
```

SQLite is created and migrated on startup. Media downloads require local tools
or the three-container Docker setup:

```bash
docker compose up -d --build
```

Local Docker uses UID/GID 1000 for `data/` and `media/`. For rootless Docker
on the VPS, follow the [setup instructions](docs/development.md#vps-setup).

## Usage

In a configured group, mention the bot (`@your_bot explain this`) or reply to
its message. To ask about another message, reply to it and mention the bot.
Enable `features.assistant` for these replies. Ordinary messages are saved as
context; edits update the saved text.

Disable BotFather privacy mode or give the bot administrator access to receive
ordinary group messages. Deleting source links also requires permission.

| Command | Action |
| --- | --- |
| `/translate` | Translate the replied-to text or media. |
| `/read` | Read the replied-to text aloud with Yandex SpeechKit. |
| `/transcribe` | Transcribe the replied-to Telegram video with Gladia. |
| `/meme` | Send media from the chat's Reddit sources. |
| `/sex` | Send media from a separate Reddit source list, with spoilers. |

Commands are group-only. The operator can use the assistant and send media
links privately; users in `linkUserIds` can send links only. Other private
users and unconfigured groups are rejected.

Per-chat `features.direct_links` enables media downloads. After sending media,
the bot tries to delete the source link and credits its sender in groups.
`spontaneous.enabled` enables unsolicited replies; see
[settings](docs/development.md#spontaneous-messages).

## Deployment

Production uses rootless Docker under `github-deploy` and Compose services
`bot`, `video`, and `gallery` in `/opt/telegram-bot`. GitHub Actions
checks code and images, publishes to GHCR, and deploys image digests over SSH
on non-documentation pushes to `main`.

[Setup and operations](docs/development.md#production) ·
[Architecture](docs/architecture.md) · [Documentation](docs/README.md)

## License

[MIT](LICENSE).
