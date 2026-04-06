# DeepSeek API Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Qwen-specific runtime surface with a DeepSeek-backed OpenAI-compatible LLM integration while preserving Telegram behavior, memory handling, and SQLite storage.

**Architecture:** Keep the existing prompt/orchestration flow intact, but rename the provider-specific config and client surface to a generic LLM layer. Introduce `LLM_*` environment variables with temporary `QWEN_*` aliases for backward compatibility, then switch docs and defaults to DeepSeek-compatible values.

**Tech Stack:** Node.js, TypeScript, OpenAI-compatible SDK, grammY, SQLite, Vitest

---

## File Structure

- Modify: `src/config/env.ts`
  - Replace Qwen-specific env parsing with generic `LLM_*` settings and temporary `QWEN_*` fallback aliases.
- Modify: `tests/env.test.ts`
  - Cover DeepSeek/default env parsing and legacy alias compatibility.
- Modify: `.env.example`
  - Publish the new DeepSeek-oriented runtime contract.
- Create: `src/llm/openai-compatible-llm-client.ts`
  - Generic chat-completions client for reply and summary generation.
- Modify: `src/app.ts`
  - Instantiate the generic LLM client.
- Modify: `src/app/chat-orchestrator.ts`
  - Swap type imports to the generic client module.
- Create: `tests/openai-compatible-llm-client.test.ts`
  - Move the current LLM client coverage onto the provider-neutral client.
- Delete: `tests/qwen-client.test.ts`
  - Retire the old test file once the new one is green.
- Modify: `README.md`
  - Document DeepSeek setup, new env names, and migration notes.
- Modify: `docs/architecture.md`
  - Replace Qwen references with provider-neutral / DeepSeek-backed wording.

## Non-Goals

- No SQLite schema changes
- No prompt redesign
- No Telegram transport changes
- No provider failover in this pass

## Migration Notes

- Keep `QWEN_*` env aliases working for one migration cycle to avoid breaking existing local `.env` files.
- Do not run `npm run migrate` as part of this work; the database schema is unaffected.

### Task 1: Generalize Runtime Configuration

**Files:**
- Modify: `src/config/env.ts`
- Modify: `tests/env.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing env parsing tests**

```ts
test("prefers generic LLM env values and applies DeepSeek defaults", () => {
  const env = parseEnv({
    TELEGRAM_BOT_TOKEN: "telegram-token",
    LLM_API_KEY: "deepseek-key"
  });

  expect(env.llmApiKey).toBe("deepseek-key");
  expect(env.llmBaseUrl).toBe("https://api.deepseek.com");
  expect(env.llmReplyModel).toBe("deepseek-chat");
  expect(env.llmSummaryModel).toBe("deepseek-chat");
});

test("accepts legacy QWEN env aliases during migration", () => {
  const env = parseEnv({
    TELEGRAM_BOT_TOKEN: "telegram-token",
    QWEN_API_KEY: "legacy-key",
    QWEN_BASE_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    QWEN_REPLY_MODEL: "qwen3.5-flash",
    QWEN_SUMMARY_MODEL: "qwen3.5-flash"
  });

  expect(env.llmApiKey).toBe("legacy-key");
  expect(env.llmBaseUrl).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
  expect(env.llmReplyModel).toBe("qwen3.5-flash");
  expect(env.llmSummaryModel).toBe("qwen3.5-flash");
});
```

- [ ] **Step 2: Run the env tests to verify the failure**

Run: `npm test -- tests/env.test.ts`

Expected: FAIL with missing `llmApiKey` / `llmBaseUrl` / `llmReplyModel` fields on the parsed env result.

- [ ] **Step 3: Implement the generic env contract with alias support**

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_BASE_URL: z
    .string()
    .url("LLM_BASE_URL must be a valid URL")
    .default("https://api.deepseek.com"),
  LLM_REPLY_MODEL: z.string().min(1).default("deepseek-chat"),
  LLM_SUMMARY_MODEL: z.string().min(1).default("deepseek-chat"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
  SQLITE_PATH: z.string().min(1).default("data/bot.sqlite"),
  PERSONA_FILE: z.string().min(1).default("config/persona.md"),
  INTERJECT_PROBABILITY: z.coerce.number().min(0).max(1).default(0.12),
  INTERJECT_COOLDOWN_MINUTES: z.coerce.number().positive().default(30),
  CHAT_IDLE_MINUTES: z.coerce.number().positive().default(30),
  MIN_MESSAGES_FOR_SUMMARY: z.coerce.number().int().positive().default(10),
  MESSAGE_CONTEXT_LIMIT: z.coerce.number().int().positive().default(16),
  SUMMARY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  MESSAGE_RETENTION_DAYS: z.coerce.number().int().min(0).default(180)
});

const parsed = envSchema.parse({
  ...rawEnv,
  TELEGRAM_BOT_TOKEN: rawEnv.TELEGRAM_BOT_TOKEN ?? rawEnv.BOT_TOKEN,
  LLM_API_KEY: rawEnv.LLM_API_KEY ?? rawEnv.QWEN_API_KEY,
  LLM_BASE_URL: rawEnv.LLM_BASE_URL ?? rawEnv.QWEN_BASE_URL,
  LLM_REPLY_MODEL: rawEnv.LLM_REPLY_MODEL ?? rawEnv.QWEN_REPLY_MODEL,
  LLM_SUMMARY_MODEL: rawEnv.LLM_SUMMARY_MODEL ?? rawEnv.QWEN_SUMMARY_MODEL,
  LLM_TIMEOUT_MS: rawEnv.LLM_TIMEOUT_MS ?? rawEnv.QWEN_TIMEOUT_MS,
  LLM_MAX_RETRIES: rawEnv.LLM_MAX_RETRIES ?? rawEnv.QWEN_MAX_RETRIES
});
```

- [ ] **Step 4: Update the returned env shape and `.env.example`**

```ts
return {
  nodeEnv: parsed.NODE_ENV,
  telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
  llmApiKey: parsed.LLM_API_KEY,
  llmBaseUrl: parsed.LLM_BASE_URL,
  llmReplyModel: parsed.LLM_REPLY_MODEL,
  llmSummaryModel: parsed.LLM_SUMMARY_MODEL,
  llmTimeoutMs: parsed.LLM_TIMEOUT_MS,
  llmMaxRetries: parsed.LLM_MAX_RETRIES,
  sqlitePath: parsed.SQLITE_PATH,
  personaFile: parsed.PERSONA_FILE,
  interjectProbability: parsed.INTERJECT_PROBABILITY,
  interjectCooldownMinutes: parsed.INTERJECT_COOLDOWN_MINUTES,
  chatIdleMinutes: parsed.CHAT_IDLE_MINUTES,
  minMessagesForSummary: parsed.MIN_MESSAGES_FOR_SUMMARY,
  messageContextLimit: parsed.MESSAGE_CONTEXT_LIMIT,
  summarySweepIntervalMs: parsed.SUMMARY_SWEEP_INTERVAL_MS,
  messageRetentionDays: parsed.MESSAGE_RETENTION_DAYS
};
```

```env
# LLM
LLM_API_KEY=your-deepseek-api-key
LLM_BASE_URL=https://api.deepseek.com
LLM_REPLY_MODEL=deepseek-chat
LLM_SUMMARY_MODEL=deepseek-chat
LLM_TIMEOUT_MS=45000
LLM_MAX_RETRIES=2
```

- [ ] **Step 5: Re-run the env tests**

Run: `npm test -- tests/env.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the config change**

```bash
git add src/config/env.ts tests/env.test.ts .env.example
git commit -m "refactor: generalize llm env config"
```

### Task 2: Replace the Qwen Client With a Provider-Neutral DeepSeek Client

**Files:**
- Create: `src/llm/openai-compatible-llm-client.ts`
- Create: `tests/openai-compatible-llm-client.test.ts`
- Delete: `tests/qwen-client.test.ts`

- [ ] **Step 1: Write the failing client tests in the new file**

```ts
import { describe, expect, test } from "vitest";

import { OpenAiCompatibleLlmClient } from "../src/llm/openai-compatible-llm-client.js";

describe("OpenAiCompatibleLlmClient", () => {
  test("retries retryable completion errors once", async () => {
    let calls = 0;
    const client = new OpenAiCompatibleLlmClient(
      {
        apiKey: "key",
        baseUrl: "https://api.deepseek.com",
        replyModel: "deepseek-chat",
        summaryModel: "deepseek-chat",
        timeoutMs: 45_000,
        maxRetries: 2
      },
      {
        chat: {
          completions: {
            create: async () => {
              calls += 1;
              if (calls === 1) {
                const error = new Error("temporary failure") as Error & { status: number };
                error.status = 500;
                throw error;
              }
              return { choices: [{ message: { content: "готово" } }] };
            }
          }
        }
      } as never
    );

    await expect(
      client.generateReply({
        persona: "Persona",
        chatSummary: null,
        selfMemoryContext: null,
        participantMemoryContext: null,
        targetDisplayName: "Tom",
        reason: "mention",
        recentMessages: []
      })
    ).resolves.toMatchObject({ text: "готово", model: "deepseek-chat", attemptCount: 2 });
  });
});
```

- [ ] **Step 2: Run the new client test to verify the failure**

Run: `npm test -- tests/openai-compatible-llm-client.test.ts`

Expected: FAIL because `src/llm/openai-compatible-llm-client.ts` does not exist yet.

- [ ] **Step 3: Implement the generic OpenAI-compatible client**

```ts
export class OpenAiCompatibleLlmClient {
  private readonly client: OpenAI;
  private readonly createCompletion: ChatCompletionsCreate;

  constructor(
    private readonly config: {
      apiKey: string;
      baseUrl: string;
      replyModel: string;
      summaryModel: string;
      timeoutMs: number;
      maxRetries: number;
    },
    client?: OpenAI
  ) {
    this.client =
      client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: config.timeoutMs,
        maxRetries: 0
      });
    this.createCompletion = this.client.chat.completions.create.bind(
      this.client.chat.completions
    );
  }
}
```

- [ ] **Step 4: Port the existing reply/summary logic with provider-neutral error text**

```ts
if (!reply) {
  throw new Error("LLM reply model returned empty content");
}

if (!raw) {
  throw new Error("LLM summary model returned empty content");
}
```

- [ ] **Step 5: Re-run the focused client tests**

Run: `npm test -- tests/openai-compatible-llm-client.test.ts`

Expected: PASS

- [ ] **Step 6: Remove the old Qwen-specific test file**

```bash
git add src/llm/openai-compatible-llm-client.ts tests/openai-compatible-llm-client.test.ts
git rm tests/qwen-client.test.ts
git commit -m "refactor: replace qwen client with generic llm client"
```

### Task 3: Rewire the Application to the New LLM Surface

**Files:**
- Modify: `src/app.ts`
- Modify: `src/app/chat-orchestrator.ts`

- [ ] **Step 1: Write the failing import/wiring updates**

```ts
import { OpenAiCompatibleLlmClient } from "./llm/openai-compatible-llm-client.js";

const llm = new OpenAiCompatibleLlmClient({
  apiKey: env.llmApiKey,
  baseUrl: env.llmBaseUrl,
  replyModel: env.llmReplyModel,
  summaryModel: env.llmSummaryModel,
  timeoutMs: env.llmTimeoutMs,
  maxRetries: env.llmMaxRetries
});
```

- [ ] **Step 2: Run typecheck to verify the current app wiring fails**

Run: `npm run typecheck`

Expected: FAIL because `app.ts` and `chat-orchestrator.ts` still import Qwen-specific types/names.

- [ ] **Step 3: Update `src/app.ts` and `src/app/chat-orchestrator.ts` to the new client**

```ts
import type {
  LlmReplyResult,
  LlmSummaryResult,
  OpenAiCompatibleLlmClient
} from "../llm/openai-compatible-llm-client.js";

constructor(
  private readonly deps: {
    db: DatabaseClient;
    qwen: OpenAiCompatibleLlmClient;
    // rename in a follow-up pass if desired; keep property rename out of this migration
  }
) {}
```

- [ ] **Step 4: Keep the dependency property name stable during migration**

```ts
const orchestrator = new ChatOrchestrator({
  db,
  qwen: llm,
  env,
  bot: {
    userId: botInfo.id,
    username: botInfo.username ?? null,
    displayName: botInfo.first_name ?? botInfo.username ?? "Bot"
  },
  replyDispatcher,
  loadPersona,
  logger,
  random: Math.random,
  now: () => new Date().toISOString()
});
```

- [ ] **Step 5: Re-run typecheck and the impacted tests**

Run: `npm run typecheck && npm test -- tests/app.test.ts tests/chat-orchestrator.test.ts tests/openai-compatible-llm-client.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the wiring changes**

```bash
git add src/app.ts src/app/chat-orchestrator.ts
git commit -m "refactor: wire app to generic llm client"
```

### Task 4: Update Documentation and DeepSeek Runtime Guidance

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing documentation expectations**

```md
- `DeepSeek`-backed `OpenAI`-compatible client for reply and summary generation
- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_REPLY_MODEL`
- `LLM_SUMMARY_MODEL`
```

- [ ] **Step 2: Update the README runtime sections**

```md
# Character Telegram Bot

Минимальная рабочая основа для Telegram-бота-персонажа на `Node.js + TypeScript + grammY + SQLite + DeepSeek`.

## Требования

- DeepSeek API key

## Основные переменные окружения

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_REPLY_MODEL`
- `LLM_SUMMARY_MODEL`
- `LLM_TIMEOUT_MS`
- `LLM_MAX_RETRIES`
```

- [ ] **Step 3: Update the architecture doc wording**

```md
### `src/llm`

Изолирует работу с `DeepSeek` через OpenAI-compatible API:

- сбор prompt-контекста;
- генерация ответа персонажа;
- генерация JSON-summary для чата и deltas по participant memories.
```

- [ ] **Step 4: Add a migration note for existing local env files**

```md
## Migration Note

Existing `QWEN_*` variables continue to work temporarily as aliases, but all new setup should use `LLM_*` variables with DeepSeek defaults.
```

- [ ] **Step 5: Run the full verification suite**

Run: `npm run typecheck && npm test && npm run build`

Expected: PASS

- [ ] **Step 6: Commit the docs update**

```bash
git add README.md docs/architecture.md .env.example
git commit -m "docs: document deepseek llm migration"
```

## Self-Review

- Spec coverage: the plan covers config parsing, client replacement, app wiring, and docs/runtime migration without touching database/storage logic.
- Placeholder scan: there are no `TODO` / `TBD` placeholders; each task includes concrete files, code, commands, and expected outcomes.
- Type consistency: the plan consistently uses `llmApiKey`, `llmBaseUrl`, `llmReplyModel`, `llmSummaryModel`, `llmTimeoutMs`, `llmMaxRetries`, and `OpenAiCompatibleLlmClient`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-06-deepseek-api-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
