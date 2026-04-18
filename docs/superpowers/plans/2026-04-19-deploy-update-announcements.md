# Deploy Update Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send one human-friendly Telegram update message after each successfully deployed commit range.

**Architecture:** GitHub Actions generates `/data/deploy-metadata.json` on the VPS before restarting the bot. On startup, the bot reads `/app/data/deploy-metadata.json`, compares its `sha` with SQLite `app_state.last_announced_deploy_sha`, uses `LLM_FAST_REPLY_MODEL` to format a short Russian Telegram HTML update, sends it to `DEPLOY_NOTIFY_CHAT_ID=-1002155313986`, and stores the sha only after a successful send.

**Tech Stack:** TypeScript, grammY, OpenAI-compatible chat completions, SQLite via `better-sqlite3`, GitHub Actions, Docker Compose.

---

## Approved Behavior

- No `DEPLOY_ANNOUNCEMENTS_ENABLED`; the feature is always active when `DEPLOY_NOTIFY_CHAT_ID` is configured.
- Add `DEPLOY_NOTIFY_CHAT_ID=-1002155313986` to production/server env examples and parse it as a required runtime config for deploy announcements.
- Do not add a commit/version env variable; deploy identity comes only from `/app/data/deploy-metadata.json`.
- Do not add `DEPLOY_METADATA_FILE`; use the fixed runtime path `/app/data/deploy-metadata.json`.
- Use `LLM_FAST_REPLY_MODEL` for deploy update formatting.
- Do not use fallback announcement text. If metadata reading, LLM formatting, or Telegram sending fails, log and continue startup.
- Save `last_announced_deploy_sha` only after Telegram send succeeds.
- If metadata is missing, invalid, has `sha: "unknown"`, or has an empty commit list, log and skip without throwing.
- If the current `sha` equals `last_announced_deploy_sha`, skip without sending.
- Use Telegram HTML output and run the LLM text through `formatTelegramHtmlReply()` before sending.
- Eval fixtures do not need updates because this is not an intent/reply-policy mode; add focused unit tests instead.

## File Map

- Modify `.github/workflows/deploy.yml`
  - Generate a metadata JSON file from the pushed commit range.
  - Upload it to `${DEPLOY_PATH}/data/deploy-metadata.json` before remote deploy restart.
- Modify `deploy/.env.server.example`
  - Add `DEPLOY_NOTIFY_CHAT_ID=-1002155313986`.
- Modify `.env.example`
  - Add deploy notification config with the same chat id or documented placeholder, depending on existing example style.
- Modify `src/config/env.ts`
  - Parse `DEPLOY_NOTIFY_CHAT_ID` as a number.
  - Expose `deployNotifyChatId` on `AppEnv`.
- Modify `src/storage/database.ts`
  - Add `app_state` schema and migration.
  - Add `getAppState(key)` and `setAppState(key, value, updatedAt)`.
- Create `src/app/deploy-metadata.ts`
  - Read and validate `/app/data/deploy-metadata.json`.
  - Export `DEPLOY_METADATA_FILE`, `DeployMetadata`, and `loadDeployMetadata()`.
- Create `src/llm/deploy-update-prompt.ts`
  - Build the deploy update formatter prompt.
- Modify `src/llm/openai-compatible-llm-client.ts`
  - Add `formatDeployUpdate()` using `fastReplyModel`, temperature `0.4`, and `enable_thinking: false`.
- Create `src/app/deploy-announcer.ts`
  - Orchestrate metadata read, SQLite dedupe, LLM formatting, Telegram send, and state update.
- Modify `src/app.ts`
  - Wire deploy announcer into startup before `bot.start()`.
- Add/modify tests:
  - `tests/storage-database.test.ts`
  - `tests/deploy-metadata.test.ts`
  - `tests/deploy-update-prompt.test.ts`
  - `tests/openai-compatible-llm-client.test.ts`
  - `tests/deploy-announcer.test.ts`
  - `tests/app.test.ts`
  - `tests/env.test.ts`
- Review/update docs:
  - `README.md`
  - `docs/development.md`
  - `docs/architecture.md`

---

## Task 1: Environment Config

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `deploy/.env.server.example`
- Test: `tests/env.test.ts`

- [ ] **Step 1: Write failing env tests**

Add tests to `tests/env.test.ts`:

```ts
test("parses deploy notification chat id", () => {
  const env = parseEnv({
    TELEGRAM_BOT_TOKEN: "telegram-token",
    LLM_API_KEY: "llm-key",
    DEPLOY_NOTIFY_CHAT_ID: "-1002155313986"
  });

  expect(env.deployNotifyChatId).toBe(-1002155313986);
});

test("requires deploy notification chat id", () => {
  expect(() =>
    parseEnv({
      TELEGRAM_BOT_TOKEN: "telegram-token",
      LLM_API_KEY: "llm-key"
    })
  ).toThrow(/DEPLOY_NOTIFY_CHAT_ID/);
});
```

- [ ] **Step 2: Run env tests and verify failure**

Run:

```bash
npm test -- tests/env.test.ts
```

Expected: FAIL because `deployNotifyChatId` is not parsed and `DEPLOY_NOTIFY_CHAT_ID` is not required.

- [ ] **Step 3: Implement env parsing**

In `src/config/env.ts`:

```ts
const envSchema = z.object({
  // existing fields...
  DEPLOY_NOTIFY_CHAT_ID: z.coerce.number().int()
});

type ParsedEnv = {
  // existing fields...
  deployNotifyChatId: number;
};

return {
  // existing fields...
  deployNotifyChatId: parsed.DEPLOY_NOTIFY_CHAT_ID
};
```

Add to `.env.example` and `deploy/.env.server.example`:

```dotenv
# Deploy announcements
DEPLOY_NOTIFY_CHAT_ID=-1002155313986
```

- [ ] **Step 4: Verify env tests pass**

Run:

```bash
npm test -- tests/env.test.ts
```

Expected: PASS.

---

## Task 2: SQLite App State

**Files:**
- Modify: `src/storage/database.ts`
- Test: `tests/storage-database.test.ts`

- [ ] **Step 1: Write failing database tests**

Add tests to `tests/storage-database.test.ts`:

```ts
test("stores app state key values", () => {
  const db = DatabaseClient.open(":memory:");

  expect(db.getAppState("last_announced_deploy_sha")).toBe(null);

  db.setAppState(
    "last_announced_deploy_sha",
    "abc123",
    "2026-04-19T10:00:00.000Z"
  );

  expect(db.getAppState("last_announced_deploy_sha")).toBe("abc123");

  db.setAppState(
    "last_announced_deploy_sha",
    "def456",
    "2026-04-19T10:05:00.000Z"
  );

  expect(db.getAppState("last_announced_deploy_sha")).toBe("def456");

  db.close();
});

test("adds app_state table when opening an existing database", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "chatbot-app-state-db-"));
  const dbPath = path.join(directory, "bot.sqlite");
  tempDirectories.push(directory);

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

  expect(db.getSchemaColumns("app_state")).toEqual(["key", "value", "updated_at"]);

  db.close();
});
```

- [ ] **Step 2: Run database tests and verify failure**

Run:

```bash
npm test -- tests/storage-database.test.ts
```

Expected: FAIL because `app_state`, `getAppState`, and `setAppState` do not exist.

- [ ] **Step 3: Implement app_state schema and methods**

In `src/storage/database.ts`, add to `schema`:

```sql
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Add methods to `DatabaseClient`:

```ts
getAppState(key: string): string | null {
  const row = this.db
    .prepare(`SELECT value FROM app_state WHERE key = ?`)
    .get(key) as { value: string } | undefined;

  return row?.value ?? null;
}

setAppState(key: string, value: string, updatedAt: string): void {
  this.db
    .prepare(
      `
        INSERT INTO app_state (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
    )
    .run(key, value, updatedAt);
}
```

No explicit migration helper is needed for the table because `db.exec(schema)` runs `CREATE TABLE IF NOT EXISTS`.

- [ ] **Step 4: Verify database tests pass**

Run:

```bash
npm test -- tests/storage-database.test.ts
```

Expected: PASS.

---

## Task 3: Deploy Metadata Loader

**Files:**
- Create: `src/app/deploy-metadata.ts`
- Test: `tests/deploy-metadata.test.ts`

- [ ] **Step 1: Write failing metadata tests**

Create `tests/deploy-metadata.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadDeployMetadata } from "../src/app/deploy-metadata.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadDeployMetadata", () => {
  test("loads valid deploy metadata", () => {
    const filePath = writeMetadata({
      sha: "9c59b85d123",
      shortSha: "9c59b85",
      branch: "main",
      builtAt: "2026-04-19T10:00:00.000Z",
      commits: ["fix: handle telegram media captions"]
    });

    expect(loadDeployMetadata(filePath)).toEqual({
      status: "ok",
      metadata: {
        sha: "9c59b85d123",
        shortSha: "9c59b85",
        branch: "main",
        builtAt: "2026-04-19T10:00:00.000Z",
        commits: ["fix: handle telegram media captions"]
      }
    });
  });

  test("skips missing metadata files", () => {
    expect(loadDeployMetadata("/tmp/does-not-exist/deploy-metadata.json")).toEqual({
      status: "skipped",
      reason: "Deploy metadata file is missing."
    });
  });

  test("skips unknown sha", () => {
    const filePath = writeMetadata({
      sha: "unknown",
      shortSha: "unknown",
      branch: "main",
      builtAt: null,
      commits: ["fix: something"]
    });

    expect(loadDeployMetadata(filePath)).toEqual({
      status: "skipped",
      reason: "Deploy metadata sha is unknown."
    });
  });

  test("skips empty commit lists", () => {
    const filePath = writeMetadata({
      sha: "9c59b85d123",
      shortSha: "9c59b85",
      branch: "main",
      builtAt: "2026-04-19T10:00:00.000Z",
      commits: []
    });

    expect(loadDeployMetadata(filePath)).toEqual({
      status: "skipped",
      reason: "Deploy metadata has no commits."
    });
  });
});

function writeMetadata(value: unknown): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "deploy-metadata-"));
  tempDirectories.push(directory);
  const filePath = path.join(directory, "deploy-metadata.json");

  writeFileSync(filePath, JSON.stringify(value), "utf8");

  return filePath;
}
```

- [ ] **Step 2: Run metadata tests and verify failure**

Run:

```bash
npm test -- tests/deploy-metadata.test.ts
```

Expected: FAIL because `src/app/deploy-metadata.ts` does not exist.

- [ ] **Step 3: Implement metadata loader**

Create `src/app/deploy-metadata.ts`:

```ts
import { readFileSync } from "node:fs";
import { z } from "zod";

export const DEPLOY_METADATA_FILE = "/app/data/deploy-metadata.json";

const deployMetadataSchema = z.object({
  sha: z.string().min(1),
  shortSha: z.string().min(1),
  branch: z.string().min(1),
  builtAt: z.string().datetime().nullable(),
  commits: z.array(z.string().min(1))
});

export type DeployMetadata = z.infer<typeof deployMetadataSchema>;

export type DeployMetadataLoadResult =
  | { status: "ok"; metadata: DeployMetadata }
  | { status: "skipped"; reason: string };

export function loadDeployMetadata(
  filePath = DEPLOY_METADATA_FILE
): DeployMetadataLoadResult {
  let raw: string;

  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        status: "skipped",
        reason: "Deploy metadata file is missing."
      };
    }

    return {
      status: "skipped",
      reason: "Deploy metadata file could not be read."
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: "skipped",
      reason: "Deploy metadata JSON is invalid."
    };
  }

  const metadata = deployMetadataSchema.safeParse(parsed);

  if (!metadata.success) {
    return {
      status: "skipped",
      reason: "Deploy metadata shape is invalid."
    };
  }

  if (metadata.data.sha === "unknown") {
    return {
      status: "skipped",
      reason: "Deploy metadata sha is unknown."
    };
  }

  if (metadata.data.commits.length === 0) {
    return {
      status: "skipped",
      reason: "Deploy metadata has no commits."
    };
  }

  return {
    status: "ok",
    metadata: metadata.data
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
```

- [ ] **Step 4: Verify metadata tests pass**

Run:

```bash
npm test -- tests/deploy-metadata.test.ts
```

Expected: PASS.

---

## Task 4: Deploy Update Prompt And LLM Method

**Files:**
- Create: `src/llm/deploy-update-prompt.ts`
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Test: `tests/deploy-update-prompt.test.ts`
- Test: `tests/openai-compatible-llm-client.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Create `tests/deploy-update-prompt.test.ts`:

```ts
import { expect, test } from "vitest";

import { buildDeployUpdatePrompt } from "../src/llm/deploy-update-prompt.js";

test("builds a Russian Telegram update formatting prompt", () => {
  const prompt = buildDeployUpdatePrompt({
    shortSha: "9c59b85",
    commits: [
      "fix: handle telegram media captions",
      "feat: add release update notifications"
    ]
  });

  expect(prompt).toContain("Write in Russian.");
  expect(prompt).toContain("<b>Добавлено</b>");
  expect(prompt).toContain("Do not mention git, commits, Docker, CI/CD, deployment");
  expect(prompt).toContain("Commit SHA: 9c59b85");
  expect(prompt).toContain("- fix: handle telegram media captions");
  expect(prompt).toContain("- feat: add release update notifications");
});
```

- [ ] **Step 2: Run prompt tests and verify failure**

Run:

```bash
npm test -- tests/deploy-update-prompt.test.ts
```

Expected: FAIL because the prompt module does not exist.

- [ ] **Step 3: Implement deploy update prompt**

Create `src/llm/deploy-update-prompt.ts`:

```ts
export function buildDeployUpdatePrompt(input: {
  shortSha: string;
  commits: string[];
}): string {
  return [
    "You are formatting a short Telegram update message about a new bot release.",
    "",
    "Input:",
    "- A list of raw git commit messages.",
    "- Optional short commit SHA.",
    "",
    "Your task:",
    "Rewrite this into a clean, human-friendly Telegram update.",
    "",
    "Requirements:",
    "- Write in Russian.",
    "- Keep it concise and readable.",
    "- Group changes into sections when useful:",
    "  - <b>Добавлено</b>",
    "  - <b>Исправлено</b>",
    "  - <b>Изменено</b>",
    "- Ignore low-value technical noise: merge commits, minor refactors, CI, formatting, dependency churn.",
    "- Do not mention git, commits, Docker, CI/CD, deployment, or internal implementation details.",
    "- Do not sound like a changelog dump or developer log.",
    "- Make it feel like a natural update from the bot to chat users.",
    "- You may lightly rephrase and combine similar changes.",
    "- Tone: casual, slightly playful, but not cringe.",
    "",
    "Formatting:",
    "- Use only Telegram HTML-compatible formatting: <b>, <i>, <code>, bullet points with •.",
    "- No markdown code blocks.",
    "- Output only the final message text. No explanations.",
    "",
    "Input data:",
    "",
    `Commit SHA: ${input.shortSha}`,
    "",
    "Commits:",
    ...input.commits.map((commit) => `- ${commit}`)
  ].join("\n");
}
```

- [ ] **Step 4: Write failing LLM client test**

Add to `tests/openai-compatible-llm-client.test.ts`:

```ts
test("formats deploy updates with the fast reply model", async () => {
  const createCompletion = vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: "<b>Исправлено</b>\n\n• Бот теперь понимает подписи к видео."
        }
      }
    ]
  });
  const client = createClient({
    createCompletion,
    fastReplyModel: "fast-reply-model"
  });

  await expect(
    client.formatDeployUpdate({
      shortSha: "9c59b85",
      commits: ["fix: handle telegram media captions"]
    })
  ).resolves.toMatchObject({
    text: "<b>Исправлено</b>\n\n• Бот теперь понимает подписи к видео.",
    model: "fast-reply-model"
  });

  expect(createCompletion).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "fast-reply-model",
      temperature: 0.4,
      enable_thinking: false,
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("fix: handle telegram media captions")
        })
      ])
    })
  );
});
```

Adjust helper names to the existing `tests/openai-compatible-llm-client.test.ts` helpers instead of creating duplicate mock setup.

- [ ] **Step 5: Run LLM client tests and verify failure**

Run:

```bash
npm test -- tests/openai-compatible-llm-client.test.ts
```

Expected: FAIL because `formatDeployUpdate` does not exist.

- [ ] **Step 6: Implement `formatDeployUpdate()`**

In `src/llm/openai-compatible-llm-client.ts`, import `buildDeployUpdatePrompt` and add:

```ts
async formatDeployUpdate(input: {
  shortSha: string;
  commits: string[];
}): Promise<LlmReplyResult> {
  const prompt = buildDeployUpdatePrompt(input);
  const promptTokensEstimate = estimateTokens(prompt);
  const startedAt = Date.now();
  const model = this.config.fastReplyModel ?? this.config.replyModel;

  this.logLlmText("llm.deploy_update.request", {
    kind: "deploy_update",
    model,
    temperature: 0.4,
    promptChars: prompt.length,
    promptTokensEstimate
  });

  const completion = await this.withRetry(() =>
    this.createCompletion({
      model,
      temperature: 0.4,
      max_tokens: 500,
      enable_thinking: false,
      messages: [
        {
          role: "system",
          content: "You format concise Telegram release updates in Russian."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    } as never)
  );
  const reply = completion.value.choices[0]?.message.content?.trim();

  if (!reply) {
    throw new Error("Deploy update model returned empty content");
  }

  this.logLlmText("llm.deploy_update.response", {
    kind: "deploy_update",
    model,
    latencyMs: Date.now() - startedAt,
    attemptCount: completion.attemptCount,
    promptTokensEstimate,
    responseChars: reply.length,
    responsePreview: toSingleLinePreview(reply)
  });

  return {
    text: reply,
    model,
    latencyMs: Date.now() - startedAt,
    attemptCount: completion.attemptCount,
    promptTokensEstimate
  };
}
```

Update the `logLlmText` payload type from:

```ts
kind: "reply" | "lookup_planner";
```

to:

```ts
kind: "reply" | "lookup_planner" | "deploy_update";
```

- [ ] **Step 7: Verify prompt and LLM tests pass**

Run:

```bash
npm test -- tests/deploy-update-prompt.test.ts tests/openai-compatible-llm-client.test.ts
```

Expected: PASS.

---

## Task 5: Deploy Announcer Service

**Files:**
- Create: `src/app/deploy-announcer.ts`
- Test: `tests/deploy-announcer.test.ts`

- [ ] **Step 1: Write failing announcer tests**

Create `tests/deploy-announcer.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";

import { maybeAnnounceDeployUpdate } from "../src/app/deploy-announcer.js";

describe("maybeAnnounceDeployUpdate", () => {
  test("skips when metadata is skipped", async () => {
    const deps = createDeps({
      loadDeployMetadata: () => ({
        status: "skipped",
        reason: "Deploy metadata file is missing."
      })
    });

    await maybeAnnounceDeployUpdate(deps);

    expect(deps.llm.formatDeployUpdate).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalledWith("deploy_announcement_skipped", {
      reason: "Deploy metadata file is missing."
    });
  });

  test("skips when sha was already announced", async () => {
    const deps = createDeps({
      getAppState: () => "sha-1"
    });

    await maybeAnnounceDeployUpdate(deps);

    expect(deps.llm.formatDeployUpdate).not.toHaveBeenCalled();
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  test("sends formatted update and stores sha after successful send", async () => {
    const deps = createDeps();

    await maybeAnnounceDeployUpdate(deps);

    expect(deps.llm.formatDeployUpdate).toHaveBeenCalledWith({
      shortSha: "sha-1",
      commits: ["fix: handle telegram media captions"]
    });
    expect(deps.sendMessage).toHaveBeenCalledWith({
      chatId: -1002155313986,
      text: "<b>Исправлено</b>\n\n• Подписи к видео теперь работают."
    });
    expect(deps.setAppState).toHaveBeenCalledWith(
      "last_announced_deploy_sha",
      "sha-1",
      "2026-04-19T10:00:00.000Z"
    );
  });

  test("logs and does not store sha when LLM fails", async () => {
    const deps = createDeps({
      formatDeployUpdate: vi.fn().mockRejectedValue(new Error("llm down"))
    });

    await maybeAnnounceDeployUpdate(deps);

    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.setAppState).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "deploy_announcement_failed",
      expect.objectContaining({
        errorMessage: "llm down"
      })
    );
  });
});

function createDeps(overrides: Partial<Parameters<typeof maybeAnnounceDeployUpdate>[0]> & {
  getAppState?: (key: string) => string | null;
  setAppState?: (key: string, value: string, updatedAt: string) => void;
  formatDeployUpdate?: ReturnType<typeof vi.fn>;
} = {}): Parameters<typeof maybeAnnounceDeployUpdate>[0] {
  const getAppState = overrides.getAppState ?? vi.fn().mockReturnValue(null);
  const setAppState = overrides.setAppState ?? vi.fn();
  const formatDeployUpdate =
    overrides.formatDeployUpdate ??
    vi.fn().mockResolvedValue({
      text: "<b>Исправлено</b>\n\n• Подписи к видео теперь работают.",
      model: "fast-reply-model",
      latencyMs: 10,
      attemptCount: 1,
      promptTokensEstimate: 20
    });

  return {
    deployNotifyChatId: -1002155313986,
    db: {
      getAppState,
      setAppState
    },
    llm: {
      formatDeployUpdate
    },
    loadDeployMetadata:
      overrides.loadDeployMetadata ??
      (() => ({
        status: "ok",
        metadata: {
          sha: "sha-1",
          shortSha: "sha-1",
          branch: "main",
          builtAt: "2026-04-19T09:59:00.000Z",
          commits: ["fix: handle telegram media captions"]
        }
      })),
    sendMessage: overrides.sendMessage ?? vi.fn().mockResolvedValue(undefined),
    logger:
      overrides.logger ??
      ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn()
      } as never),
    now: overrides.now ?? (() => "2026-04-19T10:00:00.000Z")
  };
}
```

- [ ] **Step 2: Run announcer tests and verify failure**

Run:

```bash
npm test -- tests/deploy-announcer.test.ts
```

Expected: FAIL because `src/app/deploy-announcer.ts` does not exist.

- [ ] **Step 3: Implement announcer service**

Create `src/app/deploy-announcer.ts`:

```ts
import type { LlmReplyResult } from "../llm/openai-compatible-llm-client.js";
import { serializeError, type AppLogger } from "../logging/logger.js";
import { formatTelegramHtmlReply } from "./telegram-html.js";
import {
  loadDeployMetadata as defaultLoadDeployMetadata,
  type DeployMetadataLoadResult
} from "./deploy-metadata.js";

const LAST_ANNOUNCED_DEPLOY_SHA_KEY = "last_announced_deploy_sha";

export async function maybeAnnounceDeployUpdate(input: {
  deployNotifyChatId: number;
  db: {
    getAppState(key: string): string | null;
    setAppState(key: string, value: string, updatedAt: string): void;
  };
  llm: {
    formatDeployUpdate(input: {
      shortSha: string;
      commits: string[];
    }): Promise<LlmReplyResult>;
  };
  loadDeployMetadata?: () => DeployMetadataLoadResult;
  sendMessage(input: { chatId: number; text: string }): Promise<void>;
  logger: AppLogger;
  now: () => string;
}): Promise<void> {
  const loaded = (input.loadDeployMetadata ?? defaultLoadDeployMetadata)();

  if (loaded.status === "skipped") {
    input.logger.info("deploy_announcement_skipped", {
      reason: loaded.reason
    });
    return;
  }

  const lastAnnouncedSha = input.db.getAppState(LAST_ANNOUNCED_DEPLOY_SHA_KEY);

  if (lastAnnouncedSha === loaded.metadata.sha) {
    input.logger.debug("deploy_announcement_skipped_duplicate", {
      sha: loaded.metadata.sha
    });
    return;
  }

  try {
    const result = await input.llm.formatDeployUpdate({
      shortSha: loaded.metadata.shortSha,
      commits: loaded.metadata.commits
    });
    const text = formatTelegramHtmlReply(result.text);

    await input.sendMessage({
      chatId: input.deployNotifyChatId,
      text
    });
    input.db.setAppState(
      LAST_ANNOUNCED_DEPLOY_SHA_KEY,
      loaded.metadata.sha,
      input.now()
    );
    input.logger.info("deploy_announcement_sent", {
      sha: loaded.metadata.sha,
      commitCount: loaded.metadata.commits.length,
      llmModel: result.model,
      llmLatencyMs: result.latencyMs,
      llmAttempts: result.attemptCount
    });
  } catch (error) {
    input.logger.warn("deploy_announcement_failed", {
      sha: loaded.metadata.sha,
      ...serializeError(error)
    });
  }
}
```

- [ ] **Step 4: Verify announcer tests pass**

Run:

```bash
npm test -- tests/deploy-announcer.test.ts
```

Expected: PASS.

---

## Task 6: Wire Startup Announcement

**Files:**
- Modify: `src/app.ts`
- Test: `tests/app.test.ts`

- [ ] **Step 1: Write failing app wiring tests**

In `tests/app.test.ts`, mock the announcer:

```ts
const maybeAnnounceDeployUpdate = vi.fn();

vi.mock("../src/app/deploy-announcer.js", () => ({
  maybeAnnounceDeployUpdate
}));
```

In `beforeEach`, add:

```ts
maybeAnnounceDeployUpdate.mockResolvedValue(undefined);
```

Add a test:

```ts
test("announces deploy updates before polling starts", async () => {
  const { createApplication } = await import("../src/app.js");
  const app = await createApplication(createEnv());

  await app.start();

  expect(maybeAnnounceDeployUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      deployNotifyChatId: -1002155313986,
      db: expect.any(Object),
      llm: expect.any(Object),
      sendMessage: expect.any(Function),
      logger: expect.any(Object),
      now: expect.any(Function)
    })
  );
  expect(botStart).toHaveBeenCalledWith({
    allowed_updates: ["message"]
  });
});
```

Update `createEnv()` in `tests/app.test.ts`:

```ts
deployNotifyChatId: -1002155313986,
```

- [ ] **Step 2: Run app tests and verify failure**

Run:

```bash
npm test -- tests/app.test.ts
```

Expected: FAIL because `maybeAnnounceDeployUpdate` is not called and `AppEnv` lacks `deployNotifyChatId`.

- [ ] **Step 3: Wire announcer in `src/app.ts`**

Import:

```ts
import { maybeAnnounceDeployUpdate } from "./app/deploy-announcer.js";
```

Add a non-reply sender dependency near `replyDispatcher`:

```ts
const sendDeployAnnouncement = async (chatId: number, text: string): Promise<void> => {
  await bot.api.sendMessage(chatId, text, {
    parse_mode: "HTML"
  });
};
```

Inside `start()` before `bot.start()`:

```ts
await maybeAnnounceDeployUpdate({
  deployNotifyChatId: env.deployNotifyChatId,
  db,
  llm: qwen,
  sendMessage: ({ chatId, text }) => sendDeployAnnouncement(chatId, text),
  logger,
  now: () => new Date().toISOString()
});
```

Keep failures non-blocking inside `maybeAnnounceDeployUpdate`; `start()` does not need its own try/catch.

- [ ] **Step 4: Verify app tests pass**

Run:

```bash
npm test -- tests/app.test.ts
```

Expected: PASS.

---

## Task 7: Deploy Workflow Metadata Generation

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add metadata generation step**

In `.github/workflows/deploy.yml`, after `Compute image name` and before `Build and push image`, add:

```yaml
      - name: Generate deploy metadata
        run: |
          mkdir -p deploy/generated
          BEFORE="${{ github.event.before }}"
          if [ -z "$BEFORE" ] || [ "$BEFORE" = "0000000000000000000000000000000000000000" ]; then
            RANGE="${{ github.sha }}^..${{ github.sha }}"
          else
            RANGE="$BEFORE..${{ github.sha }}"
          fi
          node --input-type=module <<'NODE'
          import { execFileSync } from "node:child_process";
          import { writeFileSync } from "node:fs";

          const before = process.env.BEFORE;
          const sha = process.env.GITHUB_SHA;
          const range = process.env.RANGE;
          const output = execFileSync("git", ["log", "--format=%s", range], {
            encoding: "utf8"
          });
          const commits = output
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          const metadata = {
            sha,
            shortSha: sha.slice(0, 7),
            branch: process.env.GITHUB_REF_NAME ?? "main",
            builtAt: new Date().toISOString(),
            commits
          };

          writeFileSync(
            "deploy/generated/deploy-metadata.json",
            `${JSON.stringify(metadata, null, 2)}\n`,
            "utf8"
          );
          NODE
        env:
          BEFORE: ${{ github.event.before }}
          RANGE: ${{ github.event.before }}..${{ github.sha }}
```

After writing this step, simplify if needed so `RANGE` is definitely available to the Node process. Do not leave duplicated/conflicting `BEFORE` or `RANGE` calculation.

- [ ] **Step 2: Upload generated metadata before remote deploy**

In the existing `Upload deploy assets` step, ensure the data directory exists and upload the metadata file:

```yaml
      - name: Upload deploy assets
        run: |
          ssh -p "${{ secrets.DEPLOY_PORT }}" "${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}" \
            "mkdir -p '${{ secrets.DEPLOY_PATH }}/data'"
          scp -P "${{ secrets.DEPLOY_PORT }}" \
            deploy/compose.yml \
            deploy/remote-deploy.sh \
            "${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:${{ secrets.DEPLOY_PATH }}/"
          scp -P "${{ secrets.DEPLOY_PORT }}" \
            deploy/generated/deploy-metadata.json \
            "${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:${{ secrets.DEPLOY_PATH }}/data/deploy-metadata.json"
```

- [ ] **Step 3: Validate YAML mentally and with local parser if available**

Run if dependencies support it:

```bash
npm test -- tests/app.test.ts
```

Expected: PASS. There is no existing workflow test; rely on careful YAML review plus full build/test in Task 9.

---

## Task 8: Documentation Updates

**Files:**
- Modify: `README.md`
- Modify: `docs/development.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update deployment docs**

In `docs/development.md`, under Production Deploy, add:

```md
### Deploy Update Announcements

The deploy workflow writes release metadata to `${DEPLOY_PATH}/data/deploy-metadata.json` before restarting the bot. Inside the container this file is available at `/app/data/deploy-metadata.json`.

On startup, the bot compares the metadata `sha` with `app_state.last_announced_deploy_sha` in SQLite. If the sha has not been announced before, the bot asks `LLM_FAST_REPLY_MODEL` to format a short Russian Telegram HTML update and sends it to `DEPLOY_NOTIFY_CHAT_ID`.

The sha is stored only after Telegram send succeeds. LLM or Telegram failures are logged and do not block bot startup.
```

Add `DEPLOY_NOTIFY_CHAT_ID` to the GitHub/VPS config section:

```md
- `DEPLOY_NOTIFY_CHAT_ID` — Telegram chat id for deploy update announcements, currently `-1002155313986`.
```

- [ ] **Step 2: Update README**

In `README.md`, add a short production feature note:

```md
- after a successful production deploy, the bot can announce a concise user-friendly update in the configured Telegram chat using generated deploy metadata and SQLite dedupe
```

Add `DEPLOY_NOTIFY_CHAT_ID=-1002155313986` to the production env list if README has one.

- [ ] **Step 3: Update architecture docs**

In `docs/architecture.md`, add a concise note:

```md
Deploy announcements are startup-side effects. The deploy workflow writes `/app/data/deploy-metadata.json`; startup reads it, dedupes against SQLite `app_state.last_announced_deploy_sha`, formats text through the fast LLM model, sends one Telegram message, and records the sha after successful send.
```

---

## Task 9: Final Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/env.test.ts tests/storage-database.test.ts tests/deploy-metadata.test.ts tests/deploy-update-prompt.test.ts tests/openai-compatible-llm-client.test.ts tests/deploy-announcer.test.ts tests/app.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Review diff**

Run:

```bash
git diff --stat
git diff -- .github/workflows/deploy.yml deploy/.env.server.example .env.example src tests README.md docs/development.md docs/architecture.md
```

Expected: only deploy announcement related changes.

---

## Implementation Approval Gate

This feature changes bot startup behavior and deploy workflow. Before implementing, confirm:

- Runtime behavior: on every startup, the bot reads `/app/data/deploy-metadata.json`; if it sees a new sha, it sends one LLM-formatted Telegram update to `DEPLOY_NOTIFY_CHAT_ID=-1002155313986` and records the sha after success.
- Affected files: `.github/workflows/deploy.yml`, env examples, `src/config/env.ts`, `src/storage/database.ts`, new deploy metadata/prompt/announcer modules, `src/llm/openai-compatible-llm-client.ts`, `src/app.ts`, tests, README/development/architecture docs.
- Testing: TDD unit tests for config, DB state, metadata loading, prompt, LLM method, announcer, and app wiring; full `typecheck`, `test`, and `build`.
- Evals: no intent eval fixture changes because this is startup/deploy notification behavior, not `/explain`, `/summarize`, or `/decide` response policy.
