# OpenAI-Compatible Provider Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LLM layer work with a wider range of OpenAI-compatible providers by adding a configurable summary JSON mode instead of assuming every provider supports `response_format: { type: "json_object" }`.

**Architecture:** Keep the existing generic `OpenAI` SDK client and current reply flow intact. Add one explicit capability flag in env/config that controls how summary JSON is requested: either strict API-level `response_format` or prompt-only JSON fallback. Preserve the existing summary parser and schema validation so the storage/memory pipeline does not need to change.

**Tech Stack:** Node.js, TypeScript, OpenAI-compatible SDK (`openai`), Zod, Vitest

---

## File Map

- Modify: `src/config/env.ts`
  Maps runtime env into typed app config; add the new summary JSON capability flag here.
- Modify: `src/llm/openai-compatible-llm-client.ts`
  Make summary requests conditional on the capability flag instead of always sending `response_format`.
- Modify: `src/llm/prompts.ts`
  Tighten the summary prompt so prompt-only mode still strongly biases the model toward returning raw JSON.
- Modify: `tests/env.test.ts`
  Cover default and override parsing for the new config.
- Modify: `tests/openai-compatible-llm-client.test.ts`
  Verify `response_format` is included only when expected and omitted in fallback mode.
- Modify: `tests/llm-prompts.test.ts`
  Verify the stricter JSON-only summary wording.
- Modify: `.env.example`
  Document the new flag with a safe default.
- Modify: `README.md`
  Replace the current “maybe you need adaptation” guidance with explicit configuration guidance.
- Modify: `docs/development.md`
  Document local provider setup and the fallback mode.
- Modify: `docs/architecture.md`
  Reflect that summary generation is now capability-driven, not hardwired to one OpenAI JSON mechanism.

### Task 1: Add Summary JSON Capability To Runtime Config

**Files:**
- Modify: `src/config/env.ts`
- Test: `tests/env.test.ts`

- [ ] **Step 1: Write the failing env tests**

```ts
test("defaults summary json mode to response_format", () => {
  const env = parseEnv({
    TELEGRAM_BOT_TOKEN: "telegram-token",
    LLM_API_KEY: "llm-key"
  });

  expect(env.llmSummaryJsonMode).toBe("response_format");
});

test("allows prompt_only summary json mode for generic providers", () => {
  const env = parseEnv({
    TELEGRAM_BOT_TOKEN: "telegram-token",
    LLM_API_KEY: "llm-key",
    LLM_SUMMARY_JSON_MODE: "prompt_only"
  });

  expect(env.llmSummaryJsonMode).toBe("prompt_only");
});
```

- [ ] **Step 2: Run the env tests to confirm the new field is missing**

Run: `npx vitest run tests/env.test.ts`

Expected: FAIL with TypeScript/runtime assertions because `llmSummaryJsonMode` is not returned yet.

- [ ] **Step 3: Extend env parsing with a typed summary JSON mode**

```ts
const envSchema = z.object({
  // ...
  LLM_SUMMARY_JSON_MODE: z
    .enum(["response_format", "prompt_only"])
    .default("response_format"),
  // ...
});

type ParsedEnv = {
  // ...
  llmSummaryJsonMode: "response_format" | "prompt_only";
  // ...
};

const usesGenericLlmVars =
  rawEnv.LLM_API_KEY !== undefined ||
  rawEnv.LLM_BASE_URL !== undefined ||
  rawEnv.LLM_REPLY_MODEL !== undefined ||
  rawEnv.LLM_SUMMARY_MODEL !== undefined ||
  rawEnv.LLM_SUMMARY_JSON_MODE !== undefined ||
  rawEnv.LLM_TIMEOUT_MS !== undefined ||
  rawEnv.LLM_MAX_RETRIES !== undefined;

const usesLegacyQwenVars =
  rawEnv.QWEN_API_KEY !== undefined ||
  rawEnv.QWEN_BASE_URL !== undefined ||
  rawEnv.QWEN_REPLY_MODEL !== undefined ||
  rawEnv.QWEN_SUMMARY_MODEL !== undefined ||
  rawEnv.QWEN_SUMMARY_JSON_MODE !== undefined ||
  rawEnv.QWEN_TIMEOUT_MS !== undefined ||
  rawEnv.QWEN_MAX_RETRIES !== undefined;

const providerEnv = usesGenericLlmVars
  ? {
      LLM_API_KEY: rawEnv.LLM_API_KEY,
      LLM_BASE_URL: rawEnv.LLM_BASE_URL,
      LLM_REPLY_MODEL: rawEnv.LLM_REPLY_MODEL,
      LLM_SUMMARY_MODEL: rawEnv.LLM_SUMMARY_MODEL,
      LLM_SUMMARY_JSON_MODE: rawEnv.LLM_SUMMARY_JSON_MODE,
      LLM_TIMEOUT_MS: rawEnv.LLM_TIMEOUT_MS,
      LLM_MAX_RETRIES: rawEnv.LLM_MAX_RETRIES
    }
  : {
      LLM_API_KEY: rawEnv.QWEN_API_KEY,
      LLM_BASE_URL:
        rawEnv.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      LLM_REPLY_MODEL: rawEnv.QWEN_REPLY_MODEL ?? "qwen-plus-character",
      LLM_SUMMARY_MODEL: rawEnv.QWEN_SUMMARY_MODEL ?? "qwen3.5-flash",
      LLM_SUMMARY_JSON_MODE:
        rawEnv.QWEN_SUMMARY_JSON_MODE ?? "response_format",
      LLM_TIMEOUT_MS: rawEnv.QWEN_TIMEOUT_MS ?? "20000",
      LLM_MAX_RETRIES: rawEnv.QWEN_MAX_RETRIES ?? "1"
    };

return {
  // ...
  llmSummaryJsonMode: parsed.LLM_SUMMARY_JSON_MODE,
  // ...
};
```

- [ ] **Step 4: Re-run the env tests**

Run: `npx vitest run tests/env.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the config slice**

```bash
git add src/config/env.ts tests/env.test.ts
git commit -m "feat: add summary json mode config"
```

### Task 2: Make Summary Requests Capability-Driven

**Files:**
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Test: `tests/openai-compatible-llm-client.test.ts`

- [ ] **Step 1: Write failing client tests for both summary modes**

```ts
test("uses response_format for summary when configured", async () => {
  let requestBody: Record<string, unknown> | undefined;

  const client = new OpenAiCompatibleLlmClient(
    {
      apiKey: "key",
      baseUrl: "https://example.com",
      replyModel: "reply-model",
      summaryModel: "summary-model",
      summaryJsonMode: "response_format",
      timeoutMs: 20_000,
      maxRetries: 1
    },
    {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            requestBody = input;
            return {
              choices: [
                {
                  message: {
                    content:
                      '{"chatSummary":"test","memoryUpdates":[],"selfMemoryUpdates":[]}'
                  }
                }
              ]
            };
          }
        }
      }
    } as never
  );

  await client.summarizeConversation({
    chatTitle: "Friends",
    currentSummary: null,
    messages: []
  });

  expect(requestBody?.response_format).toEqual({ type: "json_object" });
});

test("omits response_format in prompt_only summary mode", async () => {
  let requestBody: Record<string, unknown> | undefined;

  const client = new OpenAiCompatibleLlmClient(
    {
      apiKey: "key",
      baseUrl: "https://example.com",
      replyModel: "reply-model",
      summaryModel: "summary-model",
      summaryJsonMode: "prompt_only",
      timeoutMs: 20_000,
      maxRetries: 1
    },
    {
      chat: {
        completions: {
          create: async (input: Record<string, unknown>) => {
            requestBody = input;
            return {
              choices: [
                {
                  message: {
                    content:
                      '```json\\n{"chatSummary":"test","memoryUpdates":[],"selfMemoryUpdates":[]}\\n```'
                  }
                }
              ]
            };
          }
        }
      }
    } as never
  );

  await client.summarizeConversation({
    chatTitle: "Friends",
    currentSummary: null,
    messages: []
  });

  expect(requestBody).not.toHaveProperty("response_format");
});
```

- [ ] **Step 2: Run the LLM client tests to confirm the constructor/config is incomplete**

Run: `npx vitest run tests/openai-compatible-llm-client.test.ts`

Expected: FAIL because `summaryJsonMode` is not accepted yet and summary requests always include `response_format`.

- [ ] **Step 3: Thread the new config into the client and build the summary request conditionally**

```ts
constructor(
  private readonly config: {
    apiKey: string;
    baseUrl: string;
    replyModel: string;
    summaryModel: string;
    summaryJsonMode: "response_format" | "prompt_only";
    timeoutMs: number;
    maxRetries: number;
  },
  client?: OpenAI
) {
  // existing setup
}

async summarizeConversation(input: {
  chatTitle: string | null;
  currentSummary: string | null;
  messages: StoredMessage[];
}): Promise<LlmSummaryResult> {
  const prompt = buildSummaryPrompt(input);
  const startedAt = Date.now();
  const completion = await this.withRetry(() =>
    this.createCompletion({
      model: this.config.summaryModel,
      temperature: 0.2,
      ...(this.config.summaryJsonMode === "response_format"
        ? {
            response_format: {
              type: "json_object" as const
            }
          }
        : {}),
      messages: [
        {
          role: "system",
          content:
            "You compress group chat conversations into a short chat summary, participant memory deltas, and chat-local self-memory deltas for the bot. Return only a valid JSON object."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  );

  // existing raw -> extractJsonObject -> summarySchema.parse pipeline
}
```

- [ ] **Step 4: Wire the new env field into the app bootstrap**

```ts
const qwen = new OpenAiCompatibleLlmClient({
  apiKey: env.llmApiKey,
  baseUrl: env.llmBaseUrl,
  replyModel: env.llmReplyModel,
  summaryModel: env.llmSummaryModel,
  summaryJsonMode: env.llmSummaryJsonMode,
  timeoutMs: env.llmTimeoutMs,
  maxRetries: env.llmMaxRetries
});
```

Check every `new OpenAiCompatibleLlmClient(...)` call site, including tests that construct the client directly.

- [ ] **Step 5: Re-run the focused client tests**

Run: `npx vitest run tests/openai-compatible-llm-client.test.ts tests/app.test.ts tests/chat-orchestrator.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the runtime capability slice**

```bash
git add src/llm/openai-compatible-llm-client.ts src/app.ts tests/openai-compatible-llm-client.test.ts tests/app.test.ts tests/chat-orchestrator.test.ts
git commit -m "feat: make summary json mode provider-aware"
```

### Task 3: Harden The Prompt For Prompt-Only JSON Mode

**Files:**
- Modify: `src/llm/prompts.ts`
- Test: `tests/llm-prompts.test.ts`

- [ ] **Step 1: Write the failing prompt assertion**

```ts
expect(prompt).toContain("Return only a single valid JSON object.");
expect(prompt).toContain("Do not wrap the JSON in markdown fences.");
expect(prompt).toContain("Do not add explanations before or after the JSON.");
```

- [ ] **Step 2: Run the prompt tests**

Run: `npx vitest run tests/llm-prompts.test.ts`

Expected: FAIL because the stricter JSON-only wording is not in the summary prompt yet.

- [ ] **Step 3: Tighten the summary prompt wording without changing the schema**

```ts
"Return strict JSON with this shape:",
// existing example object
"Return only a single valid JSON object.",
"Do not wrap the JSON in markdown fences.",
"Do not add explanations before or after the JSON.",
"If you are unsure about a field, keep the arrays smaller rather than inventing data.",
```

Keep the current schema example and existing safety guidance intact; only strengthen output-shape discipline.

- [ ] **Step 4: Re-run the prompt tests**

Run: `npx vitest run tests/llm-prompts.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the prompt hardening**

```bash
git add src/llm/prompts.ts tests/llm-prompts.test.ts
git commit -m "test: harden summary prompt for prompt-only json mode"
```

### Task 4: Update User-Facing Provider Documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/development.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Add the new example env flag**

```dotenv
# Summary JSON mode:
# - response_format: use providers that support OpenAI-style response_format json_object
# - prompt_only: ask for raw JSON in the prompt without sending response_format
LLM_SUMMARY_JSON_MODE=response_format
```

- [ ] **Step 2: Replace the current limitation notes with explicit guidance**

```md
If your provider supports OpenAI-style structured JSON via `response_format: { type: "json_object" }`,
leave `LLM_SUMMARY_JSON_MODE=response_format`.

If replies work but summary fails because the provider rejects `response_format`,
set `LLM_SUMMARY_JSON_MODE=prompt_only` and keep the same `LLM_BASE_URL`,
`LLM_REPLY_MODEL`, and `LLM_SUMMARY_MODEL`.
```

Update the wording in all three docs so they all tell the same story.

- [ ] **Step 3: Reflect the new behavior in architecture docs**

```md
### `src/llm`

Isolates work with an OpenAI-compatible LLM layer:

- prompt construction;
- character reply generation;
- JSON summary generation with provider capability selection
  (`response_format` or prompt-only JSON fallback).
```

- [ ] **Step 4: Run the full verification pass**

Run: `npm test`

Expected: PASS

Run: `npm run typecheck`

Expected: PASS

Run: `npm run build`

Expected: PASS

- [ ] **Step 5: Commit the docs and verification sweep**

```bash
git add .env.example README.md docs/development.md docs/architecture.md
git commit -m "docs: document provider-aware summary configuration"
```

## Self-Review

- Spec coverage: the plan covers config surface, runtime client behavior, prompt hardening, tests, and docs.
- Placeholder scan: every task names exact files, commands, and intended code changes.
- Type consistency: the plan uses one field name everywhere: `llmSummaryJsonMode` in parsed env and `summaryJsonMode` in the client config.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-07-openai-compatible-provider-capabilities.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
