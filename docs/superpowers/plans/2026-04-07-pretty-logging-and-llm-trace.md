# Pretty Logging And LLM Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make application logs readable, include clearer error details, and optionally show raw LLM prompt/response text behind an env flag.

**Architecture:** Keep the existing single logger entry point in `src/logging/logger.ts`, but switch its terminal output from one-line JSON to a compact multi-line pretty format. Add a single boolean env flag for temporary LLM text tracing, then pass the existing app logger into the OpenAI-compatible client so prompt/response logs stay centralized and easy to remove later.

**Tech Stack:** TypeScript, Vitest, existing in-repo logger

---

### Task 1: Cover the env flag with tests

**Files:**
- Modify: `tests/env.test.ts`
- Modify: `src/config/env.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("parses LOG_LLM_TEXT as a boolean flag", () => {
  const env = parseEnv({
    TELEGRAM_BOT_TOKEN: "telegram-token",
    LLM_API_KEY: "llm-key",
    LOG_LLM_TEXT: "true"
  });

  expect(env.logLlmText).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/env.test.ts`
Expected: FAIL because `logLlmText` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
LOG_LLM_TEXT: z.coerce.boolean().default(false)
```

```ts
logLlmText: parsed.LOG_LLM_TEXT
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/env.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/env.test.ts src/config/env.ts
git commit -m "test: cover llm trace env flag"
```

### Task 2: Cover readable log formatting with tests

**Files:**
- Create: `tests/logger.test.ts`
- Modify: `src/logging/logger.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("prints multi-line readable error logs", () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const logger = createLogger({ service: "telegram-character-bot" });

  logger.error("reply_job_failed", {
    errorMessage: "temporary failure",
    errorCode: "ECONNRESET",
    chatId: 42
  });

  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ERROR reply_job_failed"));
  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("\nerror: temporary failure"));
  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("\ncode: ECONNRESET"));
  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("\nchatId: 42"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/logger.test.ts`
Expected: FAIL because the logger still emits one-line JSON.

- [ ] **Step 3: Write minimal implementation**

```ts
const line = formatPrettyLog(level, event, bindings, payload);
```

```ts
function formatPrettyLog(...) {
  return [
    `[${timestamp}] ${level.toUpperCase()} ${event}`,
    "",
    ...formattedFields,
    ""
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/logger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/logger.test.ts src/logging/logger.ts
git commit -m "feat: prettify terminal log output"
```

### Task 3: Cover optional LLM prompt/response tracing with tests

**Files:**
- Modify: `tests/openai-compatible-llm-client.test.ts`
- Modify: `tests/app.test.ts`
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Modify: `src/app.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing tests**

```ts
test("logs prompt and response text when llm text tracing is enabled", async () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn()
  };
  logger.child.mockReturnValue(logger);

  const client = new OpenAiCompatibleLlmClient(config, mockOpenAi, {
    logger,
    logLlmText: true
  });

  await client.generateReply(...);

  expect(logger.info).toHaveBeenCalledWith(
    "llm_reply_prompt",
    expect.objectContaining({ promptText: expect.any(String) })
  );
  expect(logger.info).toHaveBeenCalledWith(
    "llm_reply_response",
    expect.objectContaining({ responseText: "ready" })
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/openai-compatible-llm-client.test.ts tests/app.test.ts`
Expected: FAIL because the client does not yet accept logger tracing options or env wiring.

- [ ] **Step 3: Write minimal implementation**

```ts
new OpenAiCompatibleLlmClient(config, undefined, {
  logger: logger.child({ component: "llm" }),
  logLlmText: env.logLlmText
});
```

```ts
if (this.options.logLlmText) {
  this.options.logger?.info("llm_reply_prompt", { promptText: prompt });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/openai-compatible-llm-client.test.ts tests/app.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/openai-compatible-llm-client.test.ts tests/app.test.ts src/llm/openai-compatible-llm-client.ts src/app.ts .env.example
git commit -m "feat: add optional llm text trace logging"
```

### Task 4: Final verification

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/logging/logger.ts`
- Modify: `src/llm/openai-compatible-llm-client.ts`
- Modify: `src/app.ts`
- Modify: `.env.example`
- Modify: `tests/env.test.ts`
- Modify: `tests/logger.test.ts`
- Modify: `tests/openai-compatible-llm-client.test.ts`
- Modify: `tests/app.test.ts`

- [ ] **Step 1: Run focused verification**

Run: `npm test -- tests/env.test.ts tests/logger.test.ts tests/openai-compatible-llm-client.test.ts tests/app.test.ts`
Expected: PASS

- [ ] **Step 2: Run broader safety verification**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/config/env.ts src/logging/logger.ts src/llm/openai-compatible-llm-client.ts src/app.ts .env.example tests/env.test.ts tests/logger.test.ts tests/openai-compatible-llm-client.test.ts tests/app.test.ts
git commit -m "feat: improve log readability and add llm trace flag"
```
