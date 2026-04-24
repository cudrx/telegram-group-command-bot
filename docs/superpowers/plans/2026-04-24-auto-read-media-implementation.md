# Auto-Read Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically process supported incoming media, store reusable artifacts, feed media summaries into reply flows, remove the user-facing `read` command, and notify the admin about every warning/error.

**Architecture:** Add a small in-process auto-read coordinator around the existing media analysis functions. Persist all durable results in `media_artifacts`, use an in-memory map only for current-process dedupe, and make reply flows wait only where the product behavior requires it. Wrap the existing logger with an admin-notifying layer instead of scattering Telegram admin messages through business logic.

**Tech Stack:** TypeScript, grammy, better-sqlite3, Vitest, existing OpenAI-compatible LLM client, existing Cloudflare/OCR.Space/Gladia media providers.

---

## Bot-Behavior Approval Gate

This feature changes bot behavior, context-building, and reply policy. Before touching runtime code, present this concrete implementation summary to the user and wait for explicit approval.

**Affected files:**

- `src/domain/models.ts`
- `src/domain/response-policy.ts`
- `src/transport/telegram/normalize-message.ts`
- `src/media/telegram-media.ts`
- `src/database/schema.ts`
- `src/database/migrations.ts`
- `src/database/messages-save.ts`
- `src/database/messages-read.ts`
- `src/database/rows.ts`
- `src/database/types.ts`
- `src/database/index.ts`
- `src/logging/logger/types.ts`
- `src/logging/logger/structured.ts`
- `src/logging/logger.ts`
- `src/app.ts`
- `src/app/chat-orchestrator/index.ts`
- `src/app/chat-orchestrator/types.ts`
- `src/app/chat-orchestrator/helpers.ts`
- `src/app/chat-orchestrator/media/index.ts`
- new `src/app/admin-notifier.ts`
- new `src/app/chat-orchestrator/media/auto-read.ts`
- tests under `tests/`, especially `tests/chat-orchestrator/`, `tests/database/`, `tests/app/`, `tests/response-policy.test.ts`, `tests/telegram-media.test.ts`
- docs: `README.md`, `docs/architecture.md`, `docs/development.md`
- eval fixtures under `scripts/intent-eval-fixtures/` and tests under `tests/llm-prompts/` or `tests/*intent*` if they mention `read`

**Runtime behavior changes:**

- Supported media in authorized chats starts auto-read immediately after the message is saved.
- `answer` waits for required target media and does not answer if required media failed.
- `decide` waits for required media in its context window and does not answer if required media failed.
- `summarize` waits only for already in-flight media in its context window, then includes successful summaries when present.
- The user-facing `/read` command is removed.
- Every logger `warn` and `error` is duplicated to the admin private chat without details beyond level, event, and error message.

**Testing changes:**

- Add focused tests for normalization, DB migration, auto-read startup, in-flight dedupe, reply flow gating, summarize soft context enrichment, admin notifications, and `/read` removal.
- Update existing media/read tests that assume `/read` is a user command.
- Update intent/eval expectations so `/read` is no longer an active command.

Wait for approval before Task 1.

---

## File Structure

Create:

- `src/app/admin-notifier.ts`
  - Owns Telegram private-message admin notifications.
  - Provides a logger wrapper helper that duplicates `warn` and `error`.
  - Keeps notification send failures out of the notifying logger path.

- `src/app/chat-orchestrator/media/auto-read.ts`
  - Owns in-flight dedupe keys, retry orchestration, required/optional wait behavior, failed artifact persistence, and album first-image guard.
  - Calls existing image/audio media context functions instead of duplicating provider logic.

Modify:

- `src/domain/models.ts`
  - Remove user-facing `read` from `AssistantIntent` only after checking all compile fallout.
  - Add `mediaGroupId` to `NormalizedMessage` and `StoredMessage`.

- `src/domain/response-policy.ts`
  - Remove `read` from `COMMAND_INTENTS`.

- `src/transport/telegram/normalize-message.ts`
  - Read Telegram `media_group_id` into `mediaGroupId`.

- `src/media/telegram-media.ts`
  - Keep extraction of supported media snapshots.
  - Add direct tests for `extractMessageMediaSnapshot` if needed.

- `src/database/*`
  - Add `messages.media_group_id`.
  - Read/write `mediaGroupId`.
  - Add DB query helpers needed by album handling.

- `src/app/chat-orchestrator/index.ts`
  - Start auto-read after successful message save.
  - Replace lazy media warm path with auto-read wait/enrich behavior.

- `src/app/chat-orchestrator/media/index.ts`
  - Remove `warmNewestNearbyMedia`.
  - Expose flow-specific media wait/enrichment methods.

- `src/app/chat-orchestrator/types.ts`
  - Add admin notifier dependency only if it is not hidden behind logger.
  - Add new DB methods to dependency type through `DatabaseClient` structural usage.

- `src/app.ts`
  - Create admin notifier and notifying logger after bot initialization.
  - Pass notifying logger into application components.

- tests and docs listed in each task below.

---

## Task 1: Remove User-Facing `/read`

**Files:**

- Modify: `src/domain/models.ts`
- Modify: `src/domain/response-policy.ts`
- Modify: `src/app/chat-orchestrator/helpers.ts`
- Modify: `src/app/chat-orchestrator/types.ts`
- Modify: tests that type `intent: 'read'`
- Test: `tests/response-policy.test.ts`

- [ ] **Step 1: Update the response-policy tests first**

In `tests/response-policy.test.ts`, change both command tables so `/read` is expected to return none.

Use this shape:

```ts
test.each([
  ['/summarize', 'summarize'],
  ['/decide', 'decide'],
  ['/answer', 'answer']
] as const)('returns %s command intent in chat mode', (commandText, intent) => {
  // existing body
});

test.each([
  ['/summarize@fun_bot', 'summarize'],
  ['/decide@fun_bot', 'decide'],
  ['/answer@fun_bot', 'answer']
] as const)('returns %s bot-suffixed command intent in chat mode', (commandText, intent) => {
  // existing body
});

test.each([
  '/read',
  '/read@fun_bot',
  '/explain',
  '/explain@fun_bot'
] as const)('returns none for removed %s command', (commandText) => {
  // existing removed-command body
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- tests/response-policy.test.ts
```

Expected: FAIL because `/read` still resolves to the `read` intent.

- [ ] **Step 3: Remove `/read` from command routing**

In `src/domain/response-policy.ts`, change:

```ts
const COMMAND_INTENTS: Record<string, AssistantIntent> = {
  summarize: 'summarize',
  decide: 'decide',
  read: 'read',
  answer: 'answer'
};
```

to:

```ts
const COMMAND_INTENTS: Record<string, AssistantIntent> = {
  summarize: 'summarize',
  decide: 'decide',
  answer: 'answer'
};
```

- [ ] **Step 4: Decide whether to remove `read` from `AssistantIntent` now**

Preferred implementation: remove `read` from public `AssistantIntent` in `src/domain/models.ts`:

```ts
export type AssistantIntent = 'summarize' | 'decide' | 'answer';
```

Then introduce a private media pipeline type only where needed:

```ts
export type MediaPipelineIntent = 'read';
```

If compile fallout is too broad in one patch, keep `AssistantIntent` unchanged for this task and remove `read` in a later cleanup task. Do not leave `/read` routable.

- [ ] **Step 5: Remove public read placeholders if no longer referenced**

After removing the command path, check references:

```bash
rg -n "READ_USAGE_PLACEHOLDER|READ_DISABLED_PLACEHOLDER|READ_FAILED_PLACEHOLDER|intent: 'read'|'read'" src tests scripts llm docs README.md
```

Remove placeholders only when they are no longer used by internal media tests. If internal media generation still uses `intent: 'read'` as an implementation detail, postpone placeholder deletion until Task 5.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/response-policy.test.ts
npm run typecheck
```

Expected: response-policy PASS. Typecheck may fail if `read` was removed from `AssistantIntent`; fix all intentional fallout before continuing.

- [ ] **Step 7: Checkpoint**

Do not commit unless explicitly asked. Suggested commit message for this checkpoint:

```text
Remove user-facing read command
```

---

## Task 2: Add `mediaGroupId` To Message Models And SQLite

**Files:**

- Modify: `src/domain/models.ts`
- Modify: `src/transport/telegram/normalize-message.ts`
- Modify: `src/database/schema.ts`
- Modify: `src/database/migrations.ts`
- Modify: `src/database/messages-save.ts`
- Modify: `src/database/messages-read.ts`
- Modify: `src/database/rows.ts`
- Modify: `src/database/types.ts`
- Modify: `tests/chat-orchestrator/support/messages.ts`
- Modify: `tests/chat-orchestrator/support/fake-database.ts`
- Test: `tests/app/messages.test.ts`
- Test: `tests/database/migrations.test.ts`
- Test: `tests/database/core.test.ts`

- [ ] **Step 1: Write normalization test for `media_group_id`**

In `tests/app/messages.test.ts`, add a test near existing message normalization tests:

```ts
test('normalizes telegram media_group_id', async () => {
  const { bot, handleUpdate, orchestrator } = createAppTestHarness();

  await handleUpdate({
    update_id: 1,
    message: {
      message_id: 10,
      date: 1_776_000_000,
      media_group_id: 'album-1',
      chat: { id: 123, type: 'supergroup', title: 'Friends' },
      from: { id: 42, is_bot: false, first_name: 'Tom' },
      photo: [
        {
          file_id: 'photo-file',
          file_unique_id: 'photo-unique',
          file_size: 100
        }
      ]
    }
  });

  expect(orchestrator.handleIncomingMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      mediaGroupId: 'album-1',
      mediaSnapshot: expect.objectContaining({
        mediaKind: 'photo'
      })
    })
  );
});
```

Adapt helper names to the actual `tests/app/support.ts` API if they differ. The assertion must check `mediaGroupId`.

- [ ] **Step 2: Write migration test**

In `tests/database/migrations.test.ts`, add:

```ts
test('adds media_group_id when opening an existing database', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'chatbot-media-group-db-'));
  const dbPath = path.join(directory, 'bot.sqlite');
  trackTempDirectory(directory);

  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE chats (
      chat_id INTEGER PRIMARY KEY,
      chat_type TEXT NOT NULL,
      title TEXT,
      last_message_at TEXT,
      last_bot_message_at TEXT
    );

    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      telegram_message_id INTEGER NOT NULL,
      user_id INTEGER,
      sender_display_name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_bot INTEGER NOT NULL DEFAULT 0,
      reply_to_telegram_message_id INTEGER,
      UNIQUE (chat_id, telegram_message_id)
    );
  `);
  legacyDb.close();

  const db = DatabaseClient.open(dbPath);
  expect(db.getSchemaColumns('messages')).toContain('media_group_id');
  db.close();
});
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
npm test -- tests/app/messages.test.ts tests/database/migrations.test.ts
```

Expected: FAIL because `mediaGroupId` is not normalized or migrated.

- [ ] **Step 4: Update domain models**

In `src/domain/models.ts`, add:

```ts
mediaGroupId: string | null;
```

to both `NormalizedMessage` and `StoredMessage`.

- [ ] **Step 5: Normalize Telegram `media_group_id`**

In `src/transport/telegram/normalize-message.ts`, read the field:

```ts
function normalizeMediaGroupId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}
```

Set it on the normalized message:

```ts
mediaGroupId: normalizeMediaGroupId(
  'media_group_id' in message ? message.media_group_id : null
),
```

For reply snapshots, also set:

```ts
mediaGroupId: normalizeMediaGroupId(
  'media_group_id' in reply ? reply.media_group_id : null
),
```

- [ ] **Step 6: Update SQLite schema and migration**

In `src/database/schema.ts`, add:

```sql
media_group_id TEXT,
```

near existing media columns.

In `src/database/migrations.ts`, add:

```ts
ensureColumn(db, 'messages', 'media_group_id', 'TEXT');
```

- [ ] **Step 7: Write and read the column**

In `src/database/messages-save.ts`, add `media_group_id` to both incoming and bot insert statements. Incoming value:

```ts
incoming.mediaGroupId
```

Bot value:

```ts
null
```

In `src/database/messages-read.ts`, select:

```sql
media_group_id AS mediaGroupId,
```

in every message query.

In `src/database/types.ts`, add:

```ts
mediaGroupId?: string | null;
```

to `StoredMessageRow`.

In `src/database/rows.ts`, map:

```ts
mediaGroupId: row.mediaGroupId ?? null,
```

- [ ] **Step 8: Update test helpers**

In `tests/chat-orchestrator/support/messages.ts`, default:

```ts
mediaGroupId: null,
```

In `tests/chat-orchestrator/support/fake-database.ts`, persist `mediaGroupId` in `saveIncomingMessage`, `saveBotMessage`, and `insertMessage` calls.

- [ ] **Step 9: Run focused and type tests**

Run:

```bash
npm test -- tests/app/messages.test.ts tests/database/migrations.test.ts tests/database/core.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Checkpoint**

Suggested commit message:

```text
Store Telegram media group ids
```

---

## Task 3: Add Admin Notifier And Notifying Logger

**Files:**

- Create: `src/app/admin-notifier.ts`
- Modify: `src/logging/logger/types.ts`
- Modify: `src/logging/logger.ts`
- Modify: `src/app.ts`
- Test: new `tests/admin-notifier.test.ts`
- Test: `tests/app/lifecycle.test.ts`

- [ ] **Step 1: Write admin notifier unit tests**

Create `tests/admin-notifier.test.ts` with:

```ts
import { describe, expect, test, vi } from 'vitest';

import {
  createAdminNotifier,
  createNotifyingLogger
} from '../src/app/admin-notifier.js';

describe('createAdminNotifier', () => {
  test('sends short messages to the admin chat', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const notifier = createAdminNotifier({
      adminChatId: 42,
      sendMessage
    });

    await notifier.notify('WARN: image_analysis_failed');

    expect(sendMessage).toHaveBeenCalledWith({
      chatId: 42,
      text: 'WARN: image_analysis_failed'
    });
  });

  test('swallows send failures', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notifier = createAdminNotifier({
      adminChatId: 42,
      sendMessage: vi.fn().mockRejectedValue(new Error('telegram down'))
    });

    await expect(notifier.notify('ERROR: x')).resolves.toBeUndefined();
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});

describe('createNotifyingLogger', () => {
  test('duplicates warn and error to admin notifications', async () => {
    const base = {
      child: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    base.child.mockReturnValue(base);
    const notify = vi.fn().mockResolvedValue(undefined);
    const logger = createNotifyingLogger(base, { notify });

    logger.debug('debug_event');
    logger.info('info_event');
    logger.warn('warn_event');
    logger.error('error_event', { errorMessage: 'failed' });

    await Promise.resolve();

    expect(notify).toHaveBeenCalledWith('WARN: warn_event');
    expect(notify).toHaveBeenCalledWith('ERROR: error_event: failed');
    expect(notify).toHaveBeenCalledTimes(2);
  });

  test('keeps child loggers notifying', async () => {
    const childBase = {
      child: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    childBase.child.mockReturnValue(childBase);
    const base = { ...childBase, child: vi.fn().mockReturnValue(childBase) };
    const notify = vi.fn().mockResolvedValue(undefined);
    const logger = createNotifyingLogger(base, { notify });

    logger.child({ component: 'x' }).warn('child_warn');
    await Promise.resolve();

    expect(notify).toHaveBeenCalledWith('WARN: child_warn');
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- tests/admin-notifier.test.ts
```

Expected: FAIL because `src/app/admin-notifier.ts` does not exist.

- [ ] **Step 3: Implement `src/app/admin-notifier.ts`**

Create:

```ts
import type { AppLogger, LogFields } from '../logging/logger.js';

export type AdminNotifier = {
  notify(text: string): Promise<void>;
};

export function createAdminNotifier(input: {
  adminChatId: number;
  sendMessage: (input: { chatId: number; text: string }) => Promise<void>;
}): AdminNotifier {
  return {
    async notify(text) {
      try {
        await input.sendMessage({
          chatId: input.adminChatId,
          text
        });
      } catch (error) {
        console.warn(
          `admin notification failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  };
}

export function createNotifyingLogger(
  base: AppLogger,
  notifier: AdminNotifier
): AppLogger {
  return {
    child(bindings) {
      return createNotifyingLogger(base.child(bindings), notifier);
    },
    debug(event, payload) {
      base.debug(event, payload);
    },
    info(event, payload) {
      base.info(event, payload);
    },
    warn(event, payload = {}) {
      base.warn(event, payload);
      void notifier.notify(formatAdminLogMessage('WARN', event, payload));
    },
    error(event, payload = {}) {
      base.error(event, payload);
      void notifier.notify(formatAdminLogMessage('ERROR', event, payload));
    }
  };
}

function formatAdminLogMessage(
  level: 'WARN' | 'ERROR',
  event: string,
  payload: LogFields
): string {
  const message = readErrorMessage(payload);
  return message ? `${level}: ${event}: ${message}` : `${level}: ${event}`;
}

function readErrorMessage(payload: LogFields): string | null {
  const value = payload.errorMessage ?? payload.message;
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}
```

- [ ] **Step 4: Wire into `src/app.ts`**

After `botInfo` is known, create the admin notifier and replace the logger used by downstream components:

```ts
const baseLogger = createLogger(...);
// use baseLogger until bot is initialized
const botInfo = await bot.api.getMe();
const adminNotifier = createAdminNotifier({
  adminChatId: env.telegramAdminId,
  sendMessage: async ({ chatId, text }) => {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
  }
});
const logger = createNotifyingLogger(baseLogger, adminNotifier);
```

Keep `bot_initialized` logging on `baseLogger` if the notifier cannot exist before `getMe`. Use the notifying `logger` for orchestrator, deploy announcer, and later app code.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/admin-notifier.test.ts tests/app/lifecycle.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Suggested commit message:

```text
Notify admin about warnings and errors
```

---

## Task 4: Extract Auto-Read Coordinator Skeleton

**Files:**

- Create: `src/app/chat-orchestrator/media/auto-read.ts`
- Modify: `src/app/chat-orchestrator/media/index.ts`
- Modify: `src/app/chat-orchestrator/index.ts`
- Modify: `src/app/chat-orchestrator/types.ts`
- Test: new `tests/chat-orchestrator/auto-read.test.ts`

- [ ] **Step 1: Write auto-read starts-on-intake test**

Create `tests/chat-orchestrator/auto-read.test.ts` with a first test that proves media processing starts without a command:

```ts
import { describe, expect, test, vi } from 'vitest';

import { createIncomingMessage } from './support/messages.js';
import { FakeDatabaseClient } from './support/fake-database.js';
import { createReplyDispatcher } from './support/llm.js';
import { createOrchestrator } from './support/orchestrator.js';

describe('auto-read media intake', () => {
  test('starts image processing for an incoming photo without a command', async () => {
    const db = new FakeDatabaseClient();
    const visionProvider = {
      describe: vi.fn().mockResolvedValue({
        provider: 'cloudflare',
        providerModel: '@cf/llava',
        artifact: { type: 'text', transcript: 'a photo', language: null },
        rawResponse: {}
      })
    };
    const ocrProvider = {
      extractText: vi.fn().mockResolvedValue({
        provider: 'ocr_space',
        providerModel: 'ocr.space/parse/image:OCREngine=2',
        artifact: { type: 'text', transcript: '', language: null },
        rawResponse: {}
      })
    };
    const telegramFileApi = {
      getFile: vi.fn().mockResolvedValue({ file_path: 'photos/file.jpg' })
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const orchestrator = createOrchestrator({
      db,
      qwen: { generateReply: vi.fn() },
      replyDispatcher: createReplyDispatcher(),
      env: { mediaAnalysisEnabled: true },
      visionProvider,
      ocrProvider,
      telegramFileApi,
      fetch: fetch as never
    });

    await orchestrator.handleIncomingMessage(
      createIncomingMessage({
        messageId: 10,
        text: '',
        mediaSnapshot: {
          messageId: 10,
          mediaKind: 'photo',
          fileId: 'photo-file',
          fileUniqueId: 'photo-unique',
          mimeType: null,
          fileSize: 3,
          durationSeconds: null,
          caption: null
        }
      })
    );

    await vi.waitFor(() => {
      expect(telegramFileApi.getFile).toHaveBeenCalledWith('photo-file');
    });
  });
});
```

If provider fixture return shapes differ, use helpers from existing `tests/chat-orchestrator/media-image/*` tests. The assertion should prove no `/read` command was needed.

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- tests/chat-orchestrator/auto-read.test.ts
```

Expected: FAIL because auto-read is not started after save.

- [ ] **Step 3: Create coordinator types and keying**

In `src/app/chat-orchestrator/media/auto-read.ts`, implement:

```ts
import type { MediaMessageSnapshot, StoredMessage } from '../../../domain/models.js';
import type { AppLogger } from '../../../logging/logger.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';

export type AutoReadResult =
  | { status: 'success' }
  | { status: 'failed'; error: Error };

export class MediaAutoReadCoordinator {
  private readonly inFlight = new Map<string, Promise<AutoReadResult>>();
  private readonly albumImageKeys = new Set<string>();

  constructor(
    private readonly deps: ChatOrchestratorDeps,
    private readonly ensureMediaContext: (input: {
      request: ReplyRequest;
      media: MediaMessageSnapshot;
      logger: AppLogger;
    }) => Promise<unknown>
  ) {}

  startForIncomingMessage(message: StoredMessage, logger: AppLogger): void {
    const media = message.mediaSnapshot;
    if (!media || !this.shouldProcessIncoming(message)) {
      return;
    }

    const request = this.createSyntheticRequest(message);
    void this.ensureComplete({ request, media, logger, startIfMissing: true });
  }

  async ensureComplete(input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
    startIfMissing: boolean;
  }): Promise<AutoReadResult | null> {
    const key = buildAutoReadKey(input.media, input.request.chatId);
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    if (!input.startIfMissing) {
      return null;
    }
    const promise = this.runWithRetries(input).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  private shouldProcessIncoming(message: StoredMessage): boolean {
    const media = message.mediaSnapshot;
    if (!media) {
      return false;
    }
    if (!message.mediaGroupId) {
      return true;
    }
    if (media.mediaKind !== 'photo' && media.mediaKind !== 'document_image') {
      return false;
    }
    const albumKey = `${message.chatId}:${message.mediaGroupId}`;
    if (this.albumImageKeys.has(albumKey)) {
      return false;
    }
    this.albumImageKeys.add(albumKey);
    return true;
  }

  private async runWithRetries(input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
  }): Promise<AutoReadResult> {
    // Fill in Task 6.
    await this.ensureMediaContext(input);
    return { status: 'success' };
  }

  private createSyntheticRequest(message: StoredMessage): ReplyRequest {
    return {
      chatId: message.chatId,
      chatType: 'unknown',
      chatTitle: null,
      triggerMessageId: message.messageId,
      fromDisplayName: message.senderDisplayName,
      createdAt: message.createdAt,
      intent: 'answer',
      replyToMessageSnapshot: null,
      replyToMediaSnapshot: message.mediaSnapshot ?? null
    };
  }
}

export function buildAutoReadKey(
  media: MediaMessageSnapshot,
  chatId: number
): string {
  return media.fileUniqueId
    ? `${media.mediaKind}:file:${media.fileUniqueId}`
    : `${media.mediaKind}:message:${chatId}:${media.messageId}`;
}
```

Adjust `intent: 'answer'` if `ReplyRequest.intent` no longer accepts `read`; the coordinator does not use that intent for user behavior.

- [ ] **Step 4: Wire coordinator into media support**

In `src/app/chat-orchestrator/media/index.ts`, add a private coordinator field:

```ts
private readonly autoRead = new MediaAutoReadCoordinator(
  this.deps,
  (input) => this.ensureMediaContext(input)
);
```

Expose:

```ts
startAutoReadForIncomingMessage(message: StoredMessage, logger: AppLogger): void {
  this.autoRead.startForIncomingMessage(message, logger);
}
```

- [ ] **Step 5: Call after successful save**

In `src/app/chat-orchestrator/index.ts`, after `const chatState = ...` succeeds, fetch the stored message and start auto-read:

```ts
const storedMessage = this.deps.db.getMessageByTelegramMessageId(
  message.chatId,
  message.messageId
);

if (storedMessage) {
  this.mediaSupport.startAutoReadForIncomingMessage(storedMessage, logger);
}
```

Call this before direct-trigger decision so media starts even when no command exists.

- [ ] **Step 6: Run focused test**

Run:

```bash
npm test -- tests/chat-orchestrator/auto-read.test.ts
npm run typecheck
```

Expected: PASS after adapting provider fixtures.

- [ ] **Step 7: Checkpoint**

Suggested commit message:

```text
Start auto-read for incoming media
```

---

## Task 5: Album First-Image Guard

**Files:**

- Modify: `src/app/chat-orchestrator/media/auto-read.ts`
- Test: `tests/chat-orchestrator/auto-read.test.ts`

- [ ] **Step 1: Add album tests**

Append tests:

```ts
test('skips album video and starts on first album image', async () => {
  const db = new FakeDatabaseClient();
  const telegramFileApi = {
    getFile: vi.fn().mockResolvedValue({ file_path: 'photos/file.jpg' })
  };
  const orchestrator = createOrchestrator({
    db,
    qwen: { generateReply: vi.fn() },
    replyDispatcher: createReplyDispatcher(),
    env: { mediaAnalysisEnabled: true },
    visionProvider: createVisionProvider(),
    ocrProvider: createOcrProvider(),
    telegramFileApi,
    fetch: createFetch()
  });

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      messageId: 10,
      text: '',
      mediaGroupId: 'album-1',
      mediaSnapshot: {
        messageId: 10,
        mediaKind: 'video_note',
        fileId: 'video-file',
        fileUniqueId: 'video-unique',
        mimeType: 'video/mp4',
        fileSize: 3,
        durationSeconds: 1,
        caption: null
      }
    })
  );

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      messageId: 11,
      text: '',
      mediaGroupId: 'album-1',
      mediaSnapshot: {
        messageId: 11,
        mediaKind: 'photo',
        fileId: 'photo-file',
        fileUniqueId: 'photo-unique',
        mimeType: null,
        fileSize: 3,
        durationSeconds: null,
        caption: null
      }
    })
  );

  await vi.waitFor(() => {
    expect(telegramFileApi.getFile).toHaveBeenCalledTimes(1);
  });
  expect(telegramFileApi.getFile).toHaveBeenCalledWith('photo-file');
});

test('skips later album images after first image starts', async () => {
  // Same setup as above.
  // Send photo messageId 11 and photo messageId 12 with same mediaGroupId.
  // Assert getFile called only with first photo file id.
});
```

Replace helper placeholders (`createVisionProvider`, `createOcrProvider`, `createFetch`) with local helper functions in the test file. Define those helpers explicitly in the test file.

- [ ] **Step 2: Run tests and verify failure if guard missing**

Run:

```bash
npm test -- tests/chat-orchestrator/auto-read.test.ts
```

Expected: FAIL until album guard handles `mediaGroupId`.

- [ ] **Step 3: Implement guard**

In `MediaAutoReadCoordinator.shouldProcessIncoming`, ensure:

```ts
if (!message.mediaGroupId) {
  return true;
}

if (media.mediaKind !== 'photo' && media.mediaKind !== 'document_image') {
  return false;
}

const albumKey = `${message.chatId}:${message.mediaGroupId}`;
if (this.albumImageKeys.has(albumKey)) {
  return false;
}

this.albumImageKeys.add(albumKey);
return true;
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/chat-orchestrator/auto-read.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Suggested commit message:

```text
Process only first image in media albums
```

---

## Task 6: Retries And Failed Artifacts

**Files:**

- Modify: `src/app/chat-orchestrator/media/auto-read.ts`
- Modify: `src/app/chat-orchestrator/helpers.ts`
- Test: `tests/chat-orchestrator/auto-read.test.ts`

- [ ] **Step 1: Add retry/failure tests**

Add tests:

```ts
test('retries auto-read once before storing a failed artifact', async () => {
  const db = new FakeDatabaseClient();
  const logger = createLogger();
  const telegramFileApi = {
    getFile: vi.fn().mockRejectedValue(new Error('telegram failed'))
  };
  const orchestrator = createOrchestrator({
    db,
    logger,
    qwen: { generateReply: vi.fn() },
    replyDispatcher: createReplyDispatcher(),
    env: { mediaAnalysisEnabled: true },
    telegramFileApi
  });

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      messageId: 10,
      text: '',
      mediaSnapshot: {
        messageId: 10,
        mediaKind: 'voice',
        fileId: 'voice-file',
        fileUniqueId: 'voice-unique',
        mimeType: 'audio/ogg',
        fileSize: 3,
        durationSeconds: 1,
        caption: null
      }
    })
  );

  await vi.waitFor(() => {
    expect(db.savedMediaArtifacts).toContainEqual(
      expect.objectContaining({
        fileUniqueId: 'voice-unique',
        artifactStatus: 'failed',
        errorText: 'telegram failed'
      })
    );
  });
  expect(telegramFileApi.getFile).toHaveBeenCalledTimes(2);
  expect(logger.warn).toHaveBeenCalled();
  expect(logger.error).toHaveBeenCalledWith(
    'media_auto_read_failed',
    expect.objectContaining({ errorMessage: 'telegram failed' })
  );
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- tests/chat-orchestrator/auto-read.test.ts
```

Expected: FAIL because retries and failed artifact persistence do not exist.

- [ ] **Step 3: Add constants/helpers**

In `src/app/chat-orchestrator/helpers.ts`, add:

```ts
export const AUTO_READ_MAX_ATTEMPTS = 2;
export const AUTO_READ_FAILED_PROVIDER = 'auto_read';
export const AUTO_READ_FAILED_MODEL = 'auto_read';
export const AUTO_READ_FAILED_ARTIFACT_KIND = 'auto_read';
```

- [ ] **Step 4: Implement retries**

In `MediaAutoReadCoordinator.runWithRetries`, use:

```ts
let lastError: unknown = null;

for (let attempt = 1; attempt <= AUTO_READ_MAX_ATTEMPTS; attempt += 1) {
  try {
    const context = await this.ensureMediaContext(input);
    if (!context) {
      throw new Error('Media recognition returned no context.');
    }
    return { status: 'success' };
  } catch (error) {
    lastError = error;
    if (attempt < AUTO_READ_MAX_ATTEMPTS) {
      input.logger.warn('media_auto_read_attempt_failed', {
        attempt,
        mediaKind: input.media.mediaKind,
        ...serializeError(error)
      });
      continue;
    }
  }
}

const finalError =
  lastError instanceof Error ? lastError : new Error(String(lastError));
this.saveFailedArtifact(input, finalError);
input.logger.error('media_auto_read_failed', {
  mediaKind: input.media.mediaKind,
  ...serializeError(finalError)
});
return { status: 'failed', error: finalError };
```

Import `serializeError` and constants.

- [ ] **Step 5: Persist failed artifact**

Add a private method:

```ts
private saveFailedArtifact(
  input: { request: ReplyRequest; media: MediaMessageSnapshot },
  error: Error
): void {
  const createdAt = this.deps.now();
  this.deps.db.saveMediaArtifact({
    fileUniqueId: input.media.fileUniqueId,
    chatId: input.request.chatId,
    telegramMessageId: input.media.messageId,
    mediaKind: input.media.mediaKind,
    provider: AUTO_READ_FAILED_PROVIDER,
    providerModel: AUTO_READ_FAILED_MODEL,
    artifactKind: AUTO_READ_FAILED_ARTIFACT_KIND,
    artifactStatus: 'failed',
    artifactText: null,
    artifactJson: null,
    rawResponseJson: null,
    sourceCaption: input.media.caption,
    sourceMimeType: input.media.mimeType,
    sourceFileSize: input.media.fileSize,
    sourceDurationSeconds: input.media.durationSeconds,
    recognitionLanguage: null,
    confidenceJson: null,
    errorText: error.message,
    createdAt,
    expiresAt: addDaysIso(createdAt, this.deps.env.mediaArtifactRetentionDays)
  });
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/chat-orchestrator/auto-read.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Suggested commit message:

```text
Retry auto-read and store failed artifacts
```

---

## Task 7: Replace Lazy Warm With Required Media Gates

**Files:**

- Modify: `src/app/chat-orchestrator/media/index.ts`
- Modify: `src/app/chat-orchestrator/index.ts`
- Test: `tests/chat-orchestrator/media-context/target-media.test.ts`
- Test: `tests/chat-orchestrator/media-context/nearby-media.test.ts`
- Test: `tests/chat-orchestrator/auto-read.test.ts`

- [ ] **Step 1: Add answer gating test**

In `tests/chat-orchestrator/auto-read.test.ts`, add:

```ts
test('answer waits for target media and skips LLM after failed required media', async () => {
  const db = new FakeDatabaseClient();
  const generateReply = vi.fn();
  const replyDispatcher = createReplyDispatcher();
  const orchestrator = createOrchestrator({
    db,
    qwen: { generateReply },
    replyDispatcher,
    env: { mediaAnalysisEnabled: true },
    telegramFileApi: {
      getFile: vi.fn().mockRejectedValue(new Error('download failed'))
    }
  });

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      messageId: 10,
      text: '',
      mediaSnapshot: {
        messageId: 10,
        mediaKind: 'voice',
        fileId: 'voice-file',
        fileUniqueId: 'voice-unique',
        mimeType: 'audio/ogg',
        fileSize: 3,
        durationSeconds: 1,
        caption: null
      }
    })
  );

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      messageId: 11,
      text: '/answer',
      entities: [{ type: 'bot_command', offset: 0, length: '/answer'.length }],
      replyToMessageId: 10,
      replyToMessageSnapshot: db.getMessageByTelegramMessageId(1, 10),
      replyToMediaSnapshot: db.getMessageByTelegramMessageId(1, 10)?.mediaSnapshot ?? null
    })
  );

  await vi.waitFor(() => {
    expect(db.savedMediaArtifacts).toContainEqual(
      expect.objectContaining({ artifactStatus: 'failed' })
    );
  });
  expect(generateReply).not.toHaveBeenCalled();
  expect(replyDispatcher).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Add decide gating test**

Add a test where a prior media message is inside `decideContextLimit`, auto-read fails, and `/decide` does not call LLM.

Use:

```ts
env: { mediaAnalysisEnabled: true, decideContextLimit: 8 }
```

Send media message, then `/decide`. Assert `generateReply` and `replyDispatcher` are not called after failed artifact appears.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- tests/chat-orchestrator/auto-read.test.ts
```

Expected: FAIL because answer/decide do not gate on auto-read results yet.

- [ ] **Step 4: Add flow wait methods**

In `ChatOrchestratorMediaSupport`, add:

```ts
async waitForRequiredMedia(
  request: ReplyRequest,
  replyContext: ReplyContext,
  logger: AppLogger
): Promise<{ ok: true } | { ok: false }> {
  const media = this.getRequiredMediaForIntent(request, replyContext);

  for (const item of media) {
    const result = await this.autoRead.ensureComplete({
      request,
      media: item,
      logger,
      startIfMissing: true
    });

    if (result?.status === 'failed') {
      return { ok: false };
    }
  }

  return { ok: true };
}
```

Required media selection:

```ts
private getRequiredMediaForIntent(
  request: ReplyRequest,
  replyContext: ReplyContext
): MediaMessageSnapshot[] {
  if (request.intent === 'answer') {
    const target = getTargetMediaSnapshot(request, replyContext);
    return target ? [target] : [];
  }

  if (request.intent === 'decide') {
    return replyContext.priorContextMessages
      .map((message) => message.mediaSnapshot ?? null)
      .filter((media): media is MediaMessageSnapshot => Boolean(media));
  }

  return [];
}
```

- [ ] **Step 5: Remove lazy warm**

Delete `warmNewestNearbyMedia` from `src/app/chat-orchestrator/media/index.ts`.

In `enrichReplyContextWithNearbyMedia`, remove:

```ts
await this.warmNewestNearbyMedia(request, nearbyMediaMessages, logger);
```

The method should only read successful artifacts and append summaries.

- [ ] **Step 6: Gate before lookup and LLM generation**

In `ChatOrchestrator.executeReplyGeneration`, after building `replyContext` and before lookup:

```ts
const mediaGate = await this.mediaSupport.waitForRequiredMedia(
  request,
  replyContext,
  logger
);

if (!mediaGate.ok) {
  logger.warn('reply_job_skipped_required_media_failed', {
    intent: request.intent
  });
  return null;
}
```

Then call `enrichReplyContextWithNearbyMedia`.

For `answer`, keep existing anchor-missing behavior before media gating.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- tests/chat-orchestrator/auto-read.test.ts tests/chat-orchestrator/media-context/target-media.test.ts tests/chat-orchestrator/media-context/nearby-media.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

Suggested commit message:

```text
Gate answer and decide on required media
```

---

## Task 8: Summarize Waits For In-Flight Media And Enriches Context

**Files:**

- Modify: `src/app/chat-orchestrator/media/index.ts`
- Modify: `src/app/chat-orchestrator/index.ts`
- Test: new or existing `tests/chat-orchestrator/media-context/nearby-media.test.ts`

- [ ] **Step 1: Add summarize test**

Add a test:

```ts
test('summarize waits for in-flight media but does not start missing media read', async () => {
  const db = new FakeDatabaseClient();
  db.saveIncomingMessage(createIncomingMessage({
    messageId: 10,
    text: '',
    mediaSnapshot: {
      messageId: 10,
      mediaKind: 'photo',
      fileId: 'photo-file',
      fileUniqueId: 'photo-unique',
      mimeType: null,
      fileSize: 3,
      durationSeconds: null,
      caption: null
    }
  }));

  const generateReply = vi.fn().mockResolvedValue(createReplyResult({ text: 'summary' }));
  const telegramFileApi = { getFile: vi.fn() };
  const orchestrator = createOrchestrator({
    db,
    qwen: { generateReply },
    replyDispatcher: createReplyDispatcher(),
    env: { mediaAnalysisEnabled: true, summarizeContextLimit: 8 },
    telegramFileApi
  });

  await orchestrator.handleIncomingMessage(createIncomingMessage({
    messageId: 11,
    text: '/summarize',
    entities: [{ type: 'bot_command', offset: 0, length: '/summarize'.length }]
  }));

  expect(telegramFileApi.getFile).not.toHaveBeenCalled();
  expect(generateReply).toHaveBeenCalled();
});
```

Add a separate test where the media auto-read is already in-flight from intake and summarize waits for it, then sees `[media] ...` in `replyContext.priorContextMessages`.

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- tests/chat-orchestrator/media-context/nearby-media.test.ts
```

Expected: FAIL until summarize enrichment exists.

- [ ] **Step 3: Add optional wait method**

In `ChatOrchestratorMediaSupport`, add:

```ts
async waitForOptionalInFlightMedia(
  request: ReplyRequest,
  replyContext: ReplyContext,
  logger: AppLogger
): Promise<void> {
  if (request.intent !== 'summarize') {
    return;
  }

  const mediaItems = replyContext.priorContextMessages
    .map((message) => message.mediaSnapshot ?? null)
    .filter((media): media is MediaMessageSnapshot => Boolean(media));

  await Promise.all(
    mediaItems.map((media) =>
      this.autoRead.ensureComplete({
        request,
        media,
        logger,
        startIfMissing: false
      })
    )
  );
}
```

- [ ] **Step 4: Let context enrichment include summarize**

In `enrichReplyContextWithNearbyMedia`, change:

```ts
if (request.intent !== 'decide' && request.intent !== 'answer') {
  return replyContext;
}
```

to:

```ts
if (
  request.intent !== 'decide' &&
  request.intent !== 'answer' &&
  request.intent !== 'summarize'
) {
  return replyContext;
}
```

- [ ] **Step 5: Call optional wait before enrichment**

In `executeReplyGeneration`, after required media gate:

```ts
await this.mediaSupport.waitForOptionalInFlightMedia(
  request,
  replyContext,
  logger
);
```

Then call `enrichReplyContextWithNearbyMedia`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/chat-orchestrator/media-context/nearby-media.test.ts tests/chat-orchestrator/auto-read.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Suggested commit message:

```text
Include media summaries in summarize context
```

---

## Task 9: Update Prompt/Eval Tests And Docs For `/read` Removal

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`
- Modify: `scripts/intent-eval-fixtures/read.ts`
- Modify: `scripts/intent-eval-fixtures/index.ts`
- Modify: tests under `tests/assistant-intent-fixtures.test.ts`, `tests/evaluate-intents.test.ts`, `tests/llm-prompts/media.test.ts`, `tests/prompt-files.test.ts` as needed

- [ ] **Step 1: Search all remaining user-facing read mentions**

Run:

```bash
rg -n "/read|\\bread\\b|READ_USAGE|READ_FAILED|READ_DISABLED" README.md docs scripts tests src llm
```

Classify each hit:

- user-facing command mention: remove or replace;
- internal media extraction prompt: keep if still used internally;
- test fixture for old `/read`: remove/update.

- [ ] **Step 2: Remove user-facing docs**

Update `README.md` and `docs/architecture.md` so supported commands list only:

```text
/summarize
/decide
/answer
```

Add a short architecture note:

```text
Supported incoming media is processed automatically in authorized chats. Media
artifacts are stored and reused by answer, decide, and summarize flows.
```

- [ ] **Step 3: Update intent fixtures**

If `scripts/intent-eval-fixtures/read.ts` only exists to test `/read`, remove it from the fixture index. If the file becomes unused, delete it.

Expected index shape:

```ts
export const intentEvalFixtures = [
  ...replyFixtures,
  ...lookupFixtures,
  // no read fixtures
];
```

Use exact local names from `scripts/intent-eval-fixtures/index.ts`.

- [ ] **Step 4: Run prompt/eval tests**

Run:

```bash
npm test -- tests/assistant-intent-fixtures.test.ts tests/evaluate-intents.test.ts tests/llm-prompts/media.test.ts tests/prompt-files.test.ts
npm run typecheck
```

Expected: PASS after removing or updating read fixtures.

- [ ] **Step 5: Checkpoint**

Suggested commit message:

```text
Update docs and evals for automatic media read
```

---

## Task 10: Full Verification And Cleanup

**Files:**

- Review: `README.md`
- Review: `docs/architecture.md`
- Review: `docs/development.md`
- Review: `docs/backlog/ideas.md`
- Review: `docs/backlog/small-fixes.md`
- Review: `docs/superpowers/plans/`

- [ ] **Step 1: Run full checks**

Run:

```bash
npm run typecheck
npm test
npm run lint
```

Expected: all PASS.

- [ ] **Step 2: Inspect media behavior manually through tests**

Run the focused suites again if full test output is large:

```bash
npm test -- tests/chat-orchestrator/auto-read.test.ts tests/chat-orchestrator/media-context/target-media.test.ts tests/chat-orchestrator/media-context/nearby-media.test.ts
npm test -- tests/admin-notifier.test.ts tests/response-policy.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Review docs after implementation**

Per repository documentation rules, review:

```bash
sed -n '1,260p' README.md
sed -n '1,280p' docs/architecture.md
sed -n '1,280p' docs/development.md
```

Update these docs if they still describe:

- `/read` as a user command;
- lazy media warm as the main behavior;
- `MEDIA_ANALYSIS_ENABLED=false` as the normal default if implementation changes the default;
- media not being included in summarize.

- [ ] **Step 4: Backlog hygiene**

Check:

```bash
find docs/backlog -maxdepth 1 -type f -print
find docs/superpowers/plans -maxdepth 1 -type f -print
```

If there are implemented stale notes about media intake or read command behavior, update or remove them. Keep no more than 5 plan files in `docs/superpowers/plans/`.

- [ ] **Step 5: Final git review**

Run:

```bash
git status --short
git diff --stat
```

Review changed files. Do not commit unless the user explicitly asks.

- [ ] **Step 6: Final response checklist**

Final response must include:

- concise summary of implemented behavior;
- exact verification commands run and their result;
- any tests not run and why;
- ready-to-use commit message because files changed.

Suggested commit message:

```text
Add automatic media read pipeline
```

---

## Self-Review

Spec coverage:

- Automatic processing for supported incoming media: Tasks 4, 5, 6.
- Reuse artifacts in `answer`, `decide`, `summarize`: Tasks 7, 8.
- Remove user-facing `read`: Tasks 1, 9.
- No durable queue: Task 4 uses in-memory map plus existing artifacts.
- Admin notifications for all warn/error: Task 3.
- Retries and failed artifacts: Task 6.
- Album first image without debounce: Tasks 2, 5.
- Bot-behavior approval gate: top section.

Placeholder scan:

- The plan avoids unresolved placeholder markers.
- Some test snippets refer to existing helper names that must be adapted only where the repository already uses different local helper APIs. Do not introduce unnamed helpers without defining them in the test file.

Type consistency:

- `mediaGroupId` is the TypeScript property.
- `media_group_id` is the SQLite/Telegram field.
- `MediaAutoReadCoordinator` is the in-memory coordinator.
- `startAutoReadForIncomingMessage`, `ensureComplete`, and `waitForOptionalInFlightMedia` are the implementation entry points used by orchestrator/media support.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-24-auto-read-media-implementation.md`.

Execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, faster iteration.
2. **Inline Execution** - execute tasks in this session with checkpoints.

Choose one before implementation starts.
