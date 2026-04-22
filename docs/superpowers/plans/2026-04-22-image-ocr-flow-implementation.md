# Image OCR Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OCR.space text extraction to image media analysis so `/read`, `/explain`, and `/answer` receive separate OCR text layers plus Cloudflare visual description.

**Architecture:** Image media analysis downloads the Telegram file once, then runs Cloudflare vision description, OCR.space Russian OCR, and OCR.space default OCR in parallel. OCR outputs are stored only when non-empty; Cloudflare is stored and prompted as `visionDescription`, never as OCR text. Existing `media_artifacts` rows remain the storage boundary, with separate `artifactKind` values instead of schema migration.

**Tech Stack:** TypeScript, grammy, SQLite/better-sqlite3, OCR.space REST API, Cloudflare Workers AI REST API, OpenAI-compatible DeepSeek chat completions, Vitest.

---

## Approved Contract

- Use OCR.space endpoint `https://api.ocr.space/parse/image`.
- Send images as multipart form field `file`.
- Send API key in header `apikey`.
- Run two OCR.space requests for images:
  - Russian OCR: `language=rus`, `OCREngine=2`.
  - Default OCR: no `language`, `OCREngine=2`.
- Do not save empty OCR results.
- Do not treat Cloudflare output as OCR.
- Keep Cloudflare output as visual description only.
- Run Cloudflare and both OCR.space requests with `Promise.allSettled`.
- Continue if at least one useful image artifact is available.
- Return the existing read failure placeholder only when no useful image artifact is available.
- Do not migrate the database schema.
- Do not create commits unless the user explicitly asks; plan steps include verification checkpoints instead of commit steps because repository instructions override generic plan templates.

## Naming

- Runtime media context fields:
  - `ocrTextRu`
  - `ocrTextDefault`
  - `visionDescription`
- Media artifact kinds:
  - `ocr_text_ru`
  - `ocr_text_default`
  - `vision_description`
  - keep existing `vision_interpretation`
- Provider names:
  - `ocr_space`
  - `cloudflare`
  - keep existing `deepseek`

## Files And Responsibilities

- Create `src/media/ocr-space-provider.ts`: OCR.space multipart client, JSON parsing, text extraction, and error handling.
- Modify `src/media/types.ts`: add `OcrProvider`, OCR result types, and extend image media context-related provider contracts.
- Modify `src/config/env.ts`: add `OCR_SPACE_API_KEY`, expose `ocrSpaceApiKey`, and require it when `MEDIA_ANALYSIS_ENABLED=true`.
- Modify `src/app.ts`: construct `OcrSpaceProvider` and pass it to `ChatOrchestrator`.
- Modify `src/app/chat-orchestrator.ts`: add OCR provider dependency, image artifact cache reads, parallel image analysis, non-empty OCR persistence, and new media context fields.
- Modify `src/llm/prompts.ts`: add `visionDescription`, `ocrTextRu`, and `ocrTextDefault` to `DescribeMediaContext` and prompt rendering.
- Modify `llm/system/read.md`: separate `OCR_TEXT_RU`, `OCR_TEXT_DEFAULT`, and `VISION_DESCRIPTION` blocks.
- Modify `llm/system/explain.md` and `llm/system/answer.md`: separate target media OCR and visual description blocks.
- Modify `.env.example` and `README.md`: document `OCR_SPACE_API_KEY` and new image analysis behavior.
- Modify tests:
  - `tests/ocr-space-provider.test.ts`
  - `tests/env.test.ts`
  - `tests/app.test.ts`
  - `tests/chat-orchestrator.test.ts`
  - `tests/llm-prompts.test.ts`

## Task 1: Add OCR.space Provider

**Files:**
- Create: `src/media/ocr-space-provider.ts`
- Modify: `src/media/types.ts`
- Test: `tests/ocr-space-provider.test.ts`

- [ ] **Step 1: Write provider tests**

Create `tests/ocr-space-provider.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { OcrSpaceProvider } from '../src/media/ocr-space-provider.js';

const tempDirectories: string[] = [];

describe('OcrSpaceProvider', () => {
  afterEach(async () => {
    vi.restoreAllMocks();

    for (const directory of tempDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('sends rus OCR request with OCREngine=2 and extracts parsed text', async () => {
    const imageFilePath = await createTempFixtureFile(
      'ocr-space-test-',
      'image.jpg',
      Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    );
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });

      return jsonResponse({
        ParsedResults: [{ ParsedText: 'ГОРЖУСЬ' }],
        OCRExitCode: 1,
        IsErroredOnProcessing: false
      });
    });
    const provider = new OcrSpaceProvider({
      apiKey: 'ocr-key',
      fetch: fetchStub as typeof fetch
    });

    const result = await provider.extractText({
      filePath: imageFilePath,
      language: 'rus',
      timeoutMs: 5000
    });

    expect(result).toMatchObject({
      provider: 'ocr_space',
      providerModel: 'ocr.space/parse/image:OCREngine=2',
      text: 'ГОРЖУСЬ',
      language: 'rus'
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.ocr.space/parse/image');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toMatchObject({ apikey: 'ocr-key' });

    const body = calls[0]?.init?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get('language')).toBe('rus');
    expect(form.get('OCREngine')).toBe('2');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  test('omits language for default OCR request', async () => {
    const imageFilePath = await createTempFixtureFile(
      'ocr-space-test-',
      'image.jpg',
      Buffer.from([1, 2, 3])
    );
    let form: FormData | null = null;
    const fetchStub = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      form = init?.body as FormData;

      return jsonResponse({
        ParsedResults: [{ ParsedText: 'Leon, necesito que distraigas a Kingpin' }],
        OCRExitCode: 1,
        IsErroredOnProcessing: false
      });
    });
    const provider = new OcrSpaceProvider({
      apiKey: 'ocr-key',
      fetch: fetchStub as typeof fetch
    });

    const result = await provider.extractText({
      filePath: imageFilePath,
      language: null,
      timeoutMs: 5000
    });

    expect(result.text).toBe('Leon, necesito que distraigas a Kingpin');
    expect(result.language).toBe(null);
    expect(form?.has('language')).toBe(false);
    expect(form?.get('OCREngine')).toBe('2');
  });

  test('returns empty text for successful empty OCR response', async () => {
    const imageFilePath = await createTempFixtureFile(
      'ocr-space-test-',
      'image.jpg',
      Buffer.from([1, 2, 3])
    );
    const fetchStub = vi.fn(async () =>
      jsonResponse({
        ParsedResults: [{ ParsedText: '' }],
        OCRExitCode: 1,
        IsErroredOnProcessing: false
      })
    );
    const provider = new OcrSpaceProvider({
      apiKey: 'ocr-key',
      fetch: fetchStub as typeof fetch
    });

    const result = await provider.extractText({
      filePath: imageFilePath,
      language: 'rus',
      timeoutMs: 5000
    });

    expect(result.text).toBe('');
  });

  test('throws on OCR.space processing error', async () => {
    const imageFilePath = await createTempFixtureFile(
      'ocr-space-test-',
      'image.jpg',
      Buffer.from([1, 2, 3])
    );
    const fetchStub = vi.fn(async () =>
      jsonResponse({
        ParsedResults: [
          {
            ParsedText: '',
            ErrorMessage: 'Unable to recognize the file',
            ErrorDetails: 'bad image'
          }
        ],
        OCRExitCode: 99,
        IsErroredOnProcessing: true
      })
    );
    const provider = new OcrSpaceProvider({
      apiKey: 'ocr-key',
      fetch: fetchStub as typeof fetch
    });

    await expect(
      provider.extractText({
        filePath: imageFilePath,
        language: 'rus',
        timeoutMs: 5000
      })
    ).rejects.toThrow(/Unable to recognize the file/i);
  });
});

async function createTempFixtureFile(
  prefix: string,
  filename: string,
  bytes: Buffer
): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirectories.push(directory);
  const filePath = path.join(directory, filename);
  await writeFile(filePath, bytes);
  return filePath;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
```

- [ ] **Step 2: Run provider tests and verify RED**

Run:

```bash
npx vitest run tests/ocr-space-provider.test.ts
```

Expected: fail because `src/media/ocr-space-provider.ts` does not exist and `OcrSpaceProvider` is not exported.

- [ ] **Step 3: Add OCR provider types**

Modify `src/media/types.ts`:

```ts
export type OcrLanguage = 'rus' | null;

export type OcrProvider = {
  extractText(input: {
    filePath: string;
    language: OcrLanguage;
    timeoutMs: number;
  }): Promise<{
    provider: 'ocr_space';
    providerModel: string;
    text: string;
    language: OcrLanguage;
    rawResponse: unknown;
  }>;
};
```

- [ ] **Step 4: Implement `OcrSpaceProvider`**

Create `src/media/ocr-space-provider.ts`:

```ts
import { readFile } from 'node:fs/promises';

import type { OcrLanguage, OcrProvider } from './types.js';

const OCR_SPACE_ENDPOINT = 'https://api.ocr.space/parse/image';
const OCR_SPACE_PROVIDER_MODEL = 'ocr.space/parse/image:OCREngine=2';

export class OcrSpaceProvider implements OcrProvider {
  constructor(
    private readonly config: {
      apiKey: string;
      fetch?: typeof fetch;
    }
  ) {}

  async extractText(input: {
    filePath: string;
    language: OcrLanguage;
    timeoutMs: number;
  }): Promise<{
    provider: 'ocr_space';
    providerModel: string;
    text: string;
    language: OcrLanguage;
    rawResponse: unknown;
  }> {
    const fetchImpl = this.config.fetch ?? globalThis.fetch;
    const body = await this.buildRequestBody(input.filePath, input.language);
    const { signal, clear } = createTimeoutSignal(input.timeoutMs);
    let response: Response;

    try {
      response = await fetchImpl(OCR_SPACE_ENDPOINT, {
        method: 'POST',
        headers: {
          apikey: this.config.apiKey
        },
        body,
        signal
      });
    } finally {
      clear();
    }

    if (!response.ok) {
      const errorText = (await response.text()).trim();
      throw new Error(
        `OCR.space request failed with status ${response.status}: ${errorText || response.statusText}`
      );
    }

    const rawResponse = await readJsonResponse(response);
    ensureOcrSpaceSuccess(rawResponse);

    return {
      provider: 'ocr_space',
      providerModel: OCR_SPACE_PROVIDER_MODEL,
      text: extractParsedText(rawResponse),
      language: input.language,
      rawResponse
    };
  }

  private async buildRequestBody(
    filePath: string,
    language: OcrLanguage
  ): Promise<FormData> {
    const bytes = await readFile(filePath);
    const form = new FormData();

    form.set('file', new Blob([bytes]), 'image');
    form.set('OCREngine', '2');

    if (language) {
      form.set('language', language);
    }

    return form;
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = (await response.text()).trim();

  if (text.length === 0) {
    throw new Error('OCR.space request returned an empty response.');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('OCR.space request returned invalid JSON.');
  }
}

function extractParsedText(input: unknown): string {
  if (!isRecord(input) || !Array.isArray(input.ParsedResults)) {
    return '';
  }

  return input.ParsedResults.map((item) =>
    isRecord(item) && typeof item.ParsedText === 'string'
      ? item.ParsedText.trim()
      : ''
  )
    .filter((text) => text.length > 0)
    .join('\n')
    .trim();
}

function ensureOcrSpaceSuccess(input: unknown): void {
  if (!isRecord(input)) {
    throw new Error('OCR.space request returned an unexpected response.');
  }

  if (input.IsErroredOnProcessing === true) {
    throw new Error(formatOcrSpaceFailure(input));
  }

  if (Array.isArray(input.ParsedResults)) {
    const messages = input.ParsedResults.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      return [item.ErrorMessage, item.ErrorDetails]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    });

    if (messages.length > 0) {
      throw new Error(messages.join('; '));
    }
  }
}

function formatOcrSpaceFailure(input: Record<string, unknown>): string {
  if (Array.isArray(input.ParsedResults)) {
    const messages = input.ParsedResults.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      return [item.ErrorMessage, item.ErrorDetails]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    });

    if (messages.length > 0) {
      return messages.join('; ');
    }
  }

  return 'OCR.space request reported a processing error.';
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  if (typeof AbortSignal.timeout === 'function') {
    return {
      signal: AbortSignal.timeout(timeoutMs),
      clear: () => undefined
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
```

- [ ] **Step 5: Run provider tests and verify GREEN**

Run:

```bash
npx vitest run tests/ocr-space-provider.test.ts
```

Expected: provider tests pass.

## Task 2: Add OCR Env And App Wiring

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/app.ts`
- Modify: `.env.example`
- Test: `tests/env.test.ts`
- Test: `tests/app.test.ts`

- [ ] **Step 1: Write failing env tests**

Modify `tests/env.test.ts`.

In `applies media analysis defaults when disabled`, add:

```ts
expect(env.ocrSpaceApiKey).toBe(null);
```

In `keeps media provider and retention defaults hardcoded`, add `OCR_SPACE_API_KEY` to the parsed input and assert it:

```ts
OCR_SPACE_API_KEY: 'ocr-key',
```

```ts
expect(env.ocrSpaceApiKey).toBe('ocr-key');
```

Add a required-key test:

```ts
test('requires OCR.space key when media analysis is enabled', () => {
  expect(() =>
    parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      MEDIA_ANALYSIS_ENABLED: 'true',
      GLADIA_API_KEY: 'gladia-key',
      CLOUDFLARE_AI_API_KEY: 'cf-key',
      CLOUDFLARE_ACCOUNT_ID: 'cf-account'
    })
  ).toThrow(/OCR_SPACE_API_KEY is required/i);
});
```

Add a placeholder test near the existing placeholder media tests:

```ts
test('rejects placeholder OCR.space key when media analysis is enabled', () => {
  expect(() =>
    parseEnv({
      TELEGRAM_BOT_TOKEN: 'telegram-token',
      LLM_API_KEY: 'llm-key',
      MEDIA_ANALYSIS_ENABLED: 'true',
      GLADIA_API_KEY: 'gladia-key',
      CLOUDFLARE_AI_API_KEY: 'cf-key',
      CLOUDFLARE_ACCOUNT_ID: 'cf-account',
      OCR_SPACE_API_KEY: 'your-ocr-space-api-key'
    })
  ).toThrow(/OCR_SPACE_API_KEY contains a placeholder value/i);
});
```

- [ ] **Step 2: Run env tests and verify RED**

Run:

```bash
npx vitest run tests/env.test.ts
```

Expected: fail because `ocrSpaceApiKey` is missing and OCR key is not validated.

- [ ] **Step 3: Implement env parsing**

Modify `src/config/env.ts`.

Add to `envSchema`:

```ts
OCR_SPACE_API_KEY: z.string().min(1).optional(),
```

Add to `ParsedEnv`:

```ts
ocrSpaceApiKey: string | null;
```

Add to returned object:

```ts
ocrSpaceApiKey: parsed.OCR_SPACE_API_KEY ?? null,
```

Add to `validateMediaAnalysisConfig` after Cloudflare validation:

```ts
if (!parsed.OCR_SPACE_API_KEY) {
  throw new Error(
    'OCR_SPACE_API_KEY is required when MEDIA_ANALYSIS_ENABLED=true.'
  );
}

if (looksLikePlaceholder(parsed.OCR_SPACE_API_KEY)) {
  throw new Error(
    'OCR_SPACE_API_KEY contains a placeholder value. Replace it with a real OCR.space API key before enabling media analysis.'
  );
}
```

- [ ] **Step 4: Run env tests and verify GREEN**

Run:

```bash
npx vitest run tests/env.test.ts
```

Expected: env tests pass.

- [ ] **Step 5: Write failing app wiring test**

Modify `tests/app.test.ts`.

Add a mock constructor near the other provider constructor mocks:

```ts
const ocrSpaceConstructor = vi.fn();
```

Add mock:

```ts
vi.mock('../src/media/ocr-space-provider.js', () => ({
  OcrSpaceProvider: vi.fn().mockImplementation((...args: unknown[]) => {
    ocrSpaceConstructor(...args);

    return {
      extractText: vi.fn()
    };
  })
}));
```

In `wires media providers when media analysis is enabled`, pass OCR key:

```ts
ocrSpaceApiKey: 'ocr-key',
```

Assert constructor and orchestrator dependency:

```ts
expect(ocrSpaceConstructor).toHaveBeenCalledWith({ apiKey: 'ocr-key' });
expect(chatOrchestratorConstructor).toHaveBeenCalledWith(
  expect.objectContaining({
    ocrProvider: expect.objectContaining({
      extractText: expect.any(Function)
    })
  })
);
```

- [ ] **Step 6: Run app wiring test and verify RED**

Run:

```bash
npx vitest run tests/app.test.ts -t "wires media providers"
```

Expected: fail because `OcrSpaceProvider` is not constructed or passed to `ChatOrchestrator`.

- [ ] **Step 7: Implement app wiring**

Modify `src/app.ts`:

```ts
import { OcrSpaceProvider } from './media/ocr-space-provider.js';
```

Create the provider after `visionProvider`:

```ts
const ocrProvider =
  env.mediaAnalysisEnabled && env.ocrSpaceApiKey
    ? new OcrSpaceProvider({ apiKey: env.ocrSpaceApiKey })
    : null;
```

Pass it into `ChatOrchestrator`:

```ts
ocrProvider,
```

Modify `src/app/chat-orchestrator.ts` constructor dependency type:

```ts
ocrProvider?: OcrProvider | null;
```

Import `OcrProvider` from `../media/types.js`.

- [ ] **Step 8: Update `.env.example`**

Add under API keys:

```env
OCR_SPACE_API_KEY=your-ocr-space-api-key
```

- [ ] **Step 9: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/env.test.ts tests/app.test.ts
```

Expected: env and app wiring tests pass.

## Task 3: Extend Prompt Media Context

**Files:**
- Modify: `src/llm/prompts.ts`
- Modify: `llm/system/read.md`
- Modify: `llm/system/explain.md`
- Modify: `llm/system/answer.md`
- Test: `tests/llm-prompts.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Modify `tests/llm-prompts.test.ts`.

In the read prompt test media context, add:

```ts
visionDescription:
  'A gold medal with a ribbon and a person sitting at a computer.',
ocrTextRu: 'ГОРЖУСЬ',
ocrTextDefault: 'ГОРЖУСЬ',
```

Add assertions:

```ts
expect(prompt).toContain('OCR_TEXT_RU:');
expect(prompt).toContain('ГОРЖУСЬ');
expect(prompt).toContain('OCR_TEXT_DEFAULT:');
expect(prompt).toContain('VISION_DESCRIPTION:');
expect(prompt).toContain(
  'A gold medal with a ribbon and a person sitting at a computer.'
);
```

In answer and explain target media prompt tests, add the same fields and assert:

```ts
expect(prompt).toContain('TARGET_MEDIA_OCR_TEXT_RU:');
expect(prompt).toContain('TARGET_MEDIA_OCR_TEXT_DEFAULT:');
expect(prompt).toContain('TARGET_MEDIA_VISION_DESCRIPTION:');
```

- [ ] **Step 2: Run prompt tests and verify RED**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts
```

Expected: TypeScript errors because `DescribeMediaContext` does not accept OCR fields, or assertion failures because prompt blocks are missing.

- [ ] **Step 3: Extend `DescribeMediaContext`**

Modify `src/llm/prompts.ts`:

```ts
export type DescribeMediaContext = {
  sourceCaption: string | null;
  visionRaw: string | null;
  visionInterpretation: string | null;
  visionDescription: string | null;
  ocrTextRu: string | null;
  ocrTextDefault: string | null;
  audioTranscript: {
    transcript: string;
    language: string | null;
    sourceDurationSeconds: number | null;
  } | null;
};
```

- [ ] **Step 4: Render new read blocks**

Modify the `input.intent === 'read'` branch in `src/llm/prompts.ts`:

```ts
visionDescription: sanitizePromptText(
  input.mediaContext?.visionDescription ?? 'No vision description.'
),
ocrTextRu: sanitizePromptText(
  input.mediaContext?.ocrTextRu ?? 'No Russian OCR text.'
),
ocrTextDefault: sanitizePromptText(
  input.mediaContext?.ocrTextDefault ?? 'No default OCR text.'
),
```

Modify `llm/system/read.md`:

```md
CURRENT_COMMAND_MESSAGE:
{{currentCommandMessage}}

COMMAND_ARGUMENT_POLICY:
If the command message has extra text after /{{commandName}}, ignore it.

CAPTION:
{{caption}}

OCR_TEXT_RU:
{{ocrTextRu}}

OCR_TEXT_DEFAULT:
{{ocrTextDefault}}

VISION_DESCRIPTION:
{{visionDescription}}

VISION_RAW:
{{visionRaw}}

VISION_INTERPRETATION:
{{visionInterpretation}}

AUDIO_TRANSCRIPT:
{{audioTranscript}}

CHAT_CONTEXT:
{{chatContext}}
```

- [ ] **Step 5: Render new answer/explain target blocks**

Modify the answer/explain branch in `src/llm/prompts.ts`:

```ts
targetMediaOcrTextRu: sanitizePromptText(
  input.mediaContext?.ocrTextRu ?? 'No Russian OCR text.'
),
targetMediaOcrTextDefault: sanitizePromptText(
  input.mediaContext?.ocrTextDefault ?? 'No default OCR text.'
),
targetMediaVisionDescription: sanitizePromptText(
  input.mediaContext?.visionDescription ?? 'No vision description.'
),
```

Modify `llm/system/explain.md`:

```md
{{targetLabel}}:
{{targetMessage}}

TARGET_MEDIA_CAPTION:
{{targetMediaCaption}}

TARGET_MEDIA_OCR_TEXT_RU:
{{targetMediaOcrTextRu}}

TARGET_MEDIA_OCR_TEXT_DEFAULT:
{{targetMediaOcrTextDefault}}

TARGET_MEDIA_VISION_DESCRIPTION:
{{targetMediaVisionDescription}}

TARGET_MEDIA_RAW:
{{targetMediaRaw}}

TARGET_MEDIA_INTERPRETATION:
{{targetMediaInterpretation}}

NEARBY_CHAT_CONTEXT:
{{nearbyChatContext}}

CURRENT_COMMAND_MESSAGE:
{{currentCommandMessage}}

COMMAND_ARGUMENT_POLICY:
If the command message has extra text after /{{commandName}}, ignore it. Use {{targetLabel}}.
```

Modify `llm/system/answer.md`:

```md
TARGET_MESSAGE_TO_ANSWER:
{{targetMessage}}

TARGET_MEDIA_CAPTION:
{{targetMediaCaption}}

TARGET_MEDIA_OCR_TEXT_RU:
{{targetMediaOcrTextRu}}

TARGET_MEDIA_OCR_TEXT_DEFAULT:
{{targetMediaOcrTextDefault}}

TARGET_MEDIA_VISION_DESCRIPTION:
{{targetMediaVisionDescription}}

TARGET_MEDIA_RAW:
{{targetMediaRaw}}

TARGET_MEDIA_INTERPRETATION:
{{targetMediaInterpretation}}

NEARBY_CHAT_CONTEXT:
{{nearbyChatContext}}

CURRENT_COMMAND_MESSAGE:
{{currentCommandMessage}}

COMMAND_ARGUMENT_POLICY:
If the command message has extra text after /{{commandName}}, ignore it. Use TARGET_MESSAGE_TO_ANSWER.
```

- [ ] **Step 6: Run prompt tests and verify GREEN**

Run:

```bash
npx vitest run tests/llm-prompts.test.ts
```

Expected: prompt tests pass.

## Task 4: Parallel Image Analysis And Artifact Storage

**Files:**
- Modify: `src/app/chat-orchestrator.ts`
- Test: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Update test helper types**

Modify `tests/chat-orchestrator.test.ts` helper input type:

```ts
ocrProvider?: {
  extractText: (input: {
    filePath: string;
    language: 'rus' | null;
    timeoutMs: number;
  }) => Promise<unknown>;
} | null;
```

Pass it to `ChatOrchestrator` in `createOrchestrator`:

```ts
ocrProvider: input.ocrProvider as never,
```

Add `ocrSpaceApiKey: null` to `createEnv`.

- [ ] **Step 2: Write failing orchestration test for three parallel artifacts**

Replace or extend the existing image test `reads replied image through vision raw plus interpretation cache layers` with OCR expectations:

```ts
test('reads replied image through vision description plus OCR cache layers', async () => {
  const db = new FakeDatabaseClient();
  const generateReply = vi
    .fn()
    .mockResolvedValue(createReplyResult('ГОРЖУСЬ'));
  const replyDispatcher = vi.fn().mockResolvedValue({
    messageId: 1001,
    createdAt: '2026-04-03T12:00:30.000Z'
  });
  const describe = vi.fn().mockResolvedValue({
    provider: 'cloudflare',
    providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
    rawText: 'A gold medal with a person at a computer.',
    rawResponse: { response: 'A gold medal with a person at a computer.' }
  });
  const extractText = vi
    .fn()
    .mockImplementation(
      async (input: { language: 'rus' | null }) =>
        input.language === 'rus'
          ? {
              provider: 'ocr_space',
              providerModel: 'ocr.space/parse/image:OCREngine=2',
              text: 'ГОРЖУСЬ',
              language: 'rus',
              rawResponse: { ParsedResults: [{ ParsedText: 'ГОРЖУСЬ' }] }
            }
          : {
              provider: 'ocr_space',
              providerModel: 'ocr.space/parse/image:OCREngine=2',
              text: 'ГОРЖУСЬ',
              language: null,
              rawResponse: { ParsedResults: [{ ParsedText: 'ГОРЖУСЬ' }] }
            }
    );
  const cleanupFetch = vi
    .fn()
    .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  const orchestrator = createOrchestrator({
    db,
    qwen: { generateReply },
    replyDispatcher,
    env: { mediaAnalysisEnabled: true },
    telegramFileApi: {
      getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
    },
    fetch: cleanupFetch as typeof fetch,
    visionProvider: { describe },
    ocrProvider: { extractText }
  });

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      messageId: 2,
      text: '/read',
      entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      replyToMessageId: 90,
      replyToMediaSnapshot: {
        messageId: 90,
        mediaKind: 'photo',
        fileId: 'photo-file',
        fileUniqueId: 'photo-unique',
        mimeType: 'image/jpeg',
        fileSize: 3,
        durationSeconds: null,
        caption: 'подпись к фото'
      }
    })
  );

  expect(describe).toHaveBeenCalledTimes(1);
  expect(extractText).toHaveBeenCalledTimes(2);
  expect(extractText).toHaveBeenCalledWith(
    expect.objectContaining({ language: 'rus' })
  );
  expect(extractText).toHaveBeenCalledWith(
    expect.objectContaining({ language: null })
  );
  expect(generateReply).toHaveBeenCalledWith(
    expect.objectContaining({
      intent: 'read',
      mediaContext: expect.objectContaining({
        sourceCaption: 'подпись к фото',
        visionDescription: 'A gold medal with a person at a computer.',
        ocrTextRu: 'ГОРЖУСЬ',
        ocrTextDefault: 'ГОРЖУСЬ',
        visionInterpretation: null,
        audioTranscript: null
      })
    })
  );
  expect(db.savedMediaArtifacts).toHaveLength(4);
  expect(db.savedMediaArtifacts[0]).toMatchObject({
    provider: 'cloudflare',
    artifactKind: 'vision_description',
    artifactText: 'A gold medal with a person at a computer.'
  });
  expect(db.savedMediaArtifacts[1]).toMatchObject({
    provider: 'ocr_space',
    artifactKind: 'ocr_text_ru',
    artifactText: 'ГОРЖУСЬ',
    recognitionLanguage: 'rus'
  });
  expect(db.savedMediaArtifacts[2]).toMatchObject({
    provider: 'ocr_space',
    artifactKind: 'ocr_text_default',
    artifactText: 'ГОРЖУСЬ',
    recognitionLanguage: null
  });
  expect(db.savedMediaArtifacts[3]).toMatchObject({
    provider: 'deepseek',
    artifactKind: 'vision_interpretation',
    artifactText: 'ГОРЖУСЬ'
  });
});
```

- [ ] **Step 3: Run orchestration test and verify RED**

Run:

```bash
npx vitest run tests/chat-orchestrator.test.ts -t "vision description plus OCR"
```

Expected: fail because `ocrProvider` is not used and context fields are missing.

- [ ] **Step 4: Add constants and dependency import**

Modify `src/app/chat-orchestrator.ts` imports:

```ts
import type {
  NormalizedMediaArtifact,
  OcrLanguage,
  OcrProvider,
  SpeechToTextProvider,
  VisionProvider
} from '../media/types.js';
```

Add constants:

```ts
const IMAGE_DESCRIPTION_PROVIDER = 'cloudflare';
const IMAGE_DESCRIPTION_ARTIFACT_KIND = 'vision_description';
const OCR_PROVIDER = 'ocr_space';
const OCR_TEXT_RU_ARTIFACT_KIND = 'ocr_text_ru';
const OCR_TEXT_DEFAULT_ARTIFACT_KIND = 'ocr_text_default';
```

Keep old constants temporarily if existing cached `vision_raw` reads must continue during the task. Remove or stop using `IMAGE_RAW_ARTIFACT_KIND` only after all tests are updated.

- [ ] **Step 5: Add OCR helper methods**

Add methods to `ChatOrchestrator`:

```ts
private getCachedImageArtifact(input: {
  request: ReplyRequest;
  media: MediaMessageSnapshot;
  provider: string;
  artifactKind: string;
}): string | null {
  return (
    this.deps.db.getSuccessfulMediaArtifact({
      fileUniqueId: input.media.fileUniqueId,
      chatId: input.request.chatId,
      telegramMessageId: input.media.messageId,
      provider: input.provider,
      artifactKind: input.artifactKind
    })?.artifactText ?? null
  );
}

private saveImageTextArtifact(input: {
  request: ReplyRequest;
  media: MediaMessageSnapshot;
  provider: string;
  providerModel: string;
  artifactKind: string;
  artifactText: string;
  artifactJson: unknown;
  rawResponseJson: unknown;
  sourceFileSize: number | null;
  recognitionLanguage: string | null;
}): void {
  const createdAt = this.deps.now();

  this.deps.db.saveMediaArtifact({
    fileUniqueId: input.media.fileUniqueId,
    chatId: input.request.chatId,
    telegramMessageId: input.media.messageId,
    mediaKind: input.media.mediaKind,
    provider: input.provider,
    providerModel: input.providerModel,
    artifactKind: input.artifactKind,
    artifactStatus: 'success',
    artifactText: input.artifactText,
    artifactJson: input.artifactJson,
    rawResponseJson: input.rawResponseJson,
    sourceCaption: input.media.caption,
    sourceMimeType: input.media.mimeType,
    sourceFileSize: input.sourceFileSize,
    sourceDurationSeconds: null,
    recognitionLanguage: input.recognitionLanguage,
    confidenceJson: null,
    errorText: null,
    createdAt,
    expiresAt: addDaysIso(createdAt, this.deps.env.mediaArtifactRetentionDays)
  });
}

private async extractDownloadedImageOcr(input: {
  filePath: string;
  language: OcrLanguage;
}): Promise<{
  provider: 'ocr_space';
  providerModel: string;
  text: string;
  language: OcrLanguage;
  rawResponse: unknown;
}> {
  if (!this.deps.ocrProvider) {
    throw new Error('OCR provider is not configured.');
  }

  return this.deps.ocrProvider.extractText({
    filePath: input.filePath,
    language: input.language,
    timeoutMs: this.deps.env.llmTimeoutMs
  });
}
```

- [ ] **Step 6: Replace image generation method with parallel analysis**

Replace `generateAndStoreVisionRaw` with `generateAndStoreImageAnalysis`:

```ts
private async generateAndStoreImageAnalysis(input: {
  request: ReplyRequest;
  media: MediaMessageSnapshot;
  logger: AppLogger;
  needsVisionDescription: boolean;
  needsOcrTextRu: boolean;
  needsOcrTextDefault: boolean;
}): Promise<{
  visionDescription: string | null;
  ocrTextRu: string | null;
  ocrTextDefault: string | null;
}> {
  const telegramFileApi = this.deps.telegramFileApi;

  if (!telegramFileApi) {
    input.logger.warn('describe_telegram_file_api_missing');
    return {
      visionDescription: null,
      ocrTextRu: null,
      ocrTextDefault: null
    };
  }

  let downloaded: Awaited<ReturnType<typeof downloadTelegramFileToTemp>> | null =
    null;

  try {
    downloaded = await downloadTelegramFileToTemp({
      api: telegramFileApi,
      botToken: this.deps.env.telegramBotToken,
      fileId: input.media.fileId,
      filename: createMediaFilename(input.media),
      maxBytes: this.deps.env.mediaMaxFileBytes,
      fileSize: input.media.fileSize,
      fetch: this.deps.fetch
    });

    const jobs: Array<Promise<void>> = [];
    const result: {
      visionDescription: string | null;
      ocrTextRu: string | null;
      ocrTextDefault: string | null;
    } = {
      visionDescription: null,
      ocrTextRu: null,
      ocrTextDefault: null
    };

    if (input.needsVisionDescription) {
      jobs.push(
        this.describeDownloadedImage(downloaded.filePath)
          .then((description) => {
            result.visionDescription = description.rawText;
            this.saveImageTextArtifact({
              request: input.request,
              media: input.media,
              provider: description.provider,
              providerModel: description.providerModel,
              artifactKind: IMAGE_DESCRIPTION_ARTIFACT_KIND,
              artifactText: description.rawText,
              artifactJson: { text: description.rawText },
              rawResponseJson: description.rawResponse,
              sourceFileSize: input.media.fileSize ?? downloaded?.bytes ?? null,
              recognitionLanguage: null
            });
          })
          .catch((error: unknown) => {
            input.logger.warn('image_vision_description_failed', {
              provider: IMAGE_DESCRIPTION_PROVIDER,
              mediaKind: input.media.mediaKind,
              ...serializeError(error)
            });
          })
      );
    }

    if (input.needsOcrTextRu) {
      jobs.push(
        this.extractDownloadedImageOcr({
          filePath: downloaded.filePath,
          language: 'rus'
        })
          .then((ocr) => {
            const text = ocr.text.trim();

            if (text.length === 0) {
              return;
            }

            result.ocrTextRu = text;
            this.saveImageTextArtifact({
              request: input.request,
              media: input.media,
              provider: ocr.provider,
              providerModel: ocr.providerModel,
              artifactKind: OCR_TEXT_RU_ARTIFACT_KIND,
              artifactText: text,
              artifactJson: { text },
              rawResponseJson: ocr.rawResponse,
              sourceFileSize: input.media.fileSize ?? downloaded?.bytes ?? null,
              recognitionLanguage: ocr.language
            });
          })
          .catch((error: unknown) => {
            input.logger.warn('image_ocr_failed', {
              provider: OCR_PROVIDER,
              language: 'rus',
              mediaKind: input.media.mediaKind,
              ...serializeError(error)
            });
          })
      );
    }

    if (input.needsOcrTextDefault) {
      jobs.push(
        this.extractDownloadedImageOcr({
          filePath: downloaded.filePath,
          language: null
        })
          .then((ocr) => {
            const text = ocr.text.trim();

            if (text.length === 0) {
              return;
            }

            result.ocrTextDefault = text;
            this.saveImageTextArtifact({
              request: input.request,
              media: input.media,
              provider: ocr.provider,
              providerModel: ocr.providerModel,
              artifactKind: OCR_TEXT_DEFAULT_ARTIFACT_KIND,
              artifactText: text,
              artifactJson: { text },
              rawResponseJson: ocr.rawResponse,
              sourceFileSize: input.media.fileSize ?? downloaded?.bytes ?? null,
              recognitionLanguage: null
            });
          })
          .catch((error: unknown) => {
            input.logger.warn('image_ocr_failed', {
              provider: OCR_PROVIDER,
              language: null,
              mediaKind: input.media.mediaKind,
              ...serializeError(error)
            });
          })
      );
    }

    await Promise.allSettled(jobs);

    return result;
  } finally {
    if (downloaded) {
      await downloaded.cleanup();
    }
  }
}
```

- [ ] **Step 7: Update `ensureImageMediaContext`**

Modify `ensureImageMediaContext` to read all three cache layers first:

```ts
let visionDescription = this.getCachedImageArtifact({
  request: input.request,
  media: input.media,
  provider: IMAGE_DESCRIPTION_PROVIDER,
  artifactKind: IMAGE_DESCRIPTION_ARTIFACT_KIND
});
let ocrTextRu = this.getCachedImageArtifact({
  request: input.request,
  media: input.media,
  provider: OCR_PROVIDER,
  artifactKind: OCR_TEXT_RU_ARTIFACT_KIND
});
let ocrTextDefault = this.getCachedImageArtifact({
  request: input.request,
  media: input.media,
  provider: OCR_PROVIDER,
  artifactKind: OCR_TEXT_DEFAULT_ARTIFACT_KIND
});

if (!visionDescription || !ocrTextRu || !ocrTextDefault) {
  const generated = await this.generateAndStoreImageAnalysis({
    ...input,
    needsVisionDescription: !visionDescription,
    needsOcrTextRu: !ocrTextRu,
    needsOcrTextDefault: !ocrTextDefault
  });

  visionDescription = visionDescription ?? generated.visionDescription;
  ocrTextRu = ocrTextRu ?? generated.ocrTextRu;
  ocrTextDefault = ocrTextDefault ?? generated.ocrTextDefault;
}

if (!visionDescription && !ocrTextRu && !ocrTextDefault) {
  return null;
}
```

Update interpretation generation call:

```ts
visionInterpretation = await this.generateAndStoreVisionInterpretation({
  request: input.request,
  media: input.media,
  visionDescription,
  ocrTextRu,
  ocrTextDefault
});
```

Return context:

```ts
return {
  sourceCaption: input.media.caption,
  visionRaw: null,
  visionDescription,
  ocrTextRu,
  ocrTextDefault,
  visionInterpretation,
  audioTranscript: null
};
```

- [ ] **Step 8: Update interpretation generation input**

Change `generateAndStoreVisionInterpretation` input:

```ts
private async generateAndStoreVisionInterpretation(input: {
  request: ReplyRequest;
  media: MediaMessageSnapshot;
  visionDescription: string | null;
  ocrTextRu: string | null;
  ocrTextDefault: string | null;
}): Promise<string | null> {
```

Change media context in its `generateReply` call:

```ts
mediaContext: {
  sourceCaption: input.media.caption,
  visionRaw: null,
  visionDescription: input.visionDescription,
  ocrTextRu: input.ocrTextRu,
  ocrTextDefault: input.ocrTextDefault,
  visionInterpretation: null,
  audioTranscript: null
}
```

- [ ] **Step 9: Update transcript context builder**

Modify `buildTranscriptMediaContext` return object:

```ts
return {
  sourceCaption: input.media.caption,
  visionRaw: null,
  visionDescription: null,
  ocrTextRu: null,
  ocrTextDefault: null,
  visionInterpretation: null,
  audioTranscript: {
    transcript: input.artifact.transcript,
    language: input.artifact.language,
    sourceDurationSeconds: input.sourceDurationSeconds
  }
};
```

- [ ] **Step 10: Run orchestration test and verify GREEN**

Run:

```bash
npx vitest run tests/chat-orchestrator.test.ts -t "vision description plus OCR"
```

Expected: focused orchestration test passes.

## Task 5: Empty OCR And Partial Failure Fallbacks

**Files:**
- Modify: `src/app/chat-orchestrator.ts`
- Test: `tests/chat-orchestrator.test.ts`

- [ ] **Step 1: Write failing test that empty OCR is not saved**

Add to `tests/chat-orchestrator.test.ts`:

```ts
test('does not save empty OCR artifacts and continues with vision description', async () => {
  const db = new FakeDatabaseClient();
  const generateReply = vi
    .fn()
    .mockResolvedValue(createReplyResult('Описание картинки'));
  const replyDispatcher = vi.fn().mockResolvedValue({
    messageId: 1001,
    createdAt: '2026-04-03T12:00:30.000Z'
  });
  const describe = vi.fn().mockResolvedValue({
    provider: 'cloudflare',
    providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
    rawText: 'A gold medal with a person at a computer.',
    rawResponse: { response: 'A gold medal with a person at a computer.' }
  });
  const extractText = vi.fn().mockResolvedValue({
    provider: 'ocr_space',
    providerModel: 'ocr.space/parse/image:OCREngine=2',
    text: '',
    language: 'rus',
    rawResponse: { ParsedResults: [{ ParsedText: '' }] }
  });
  const orchestrator = createOrchestrator({
    db,
    qwen: { generateReply },
    replyDispatcher,
    env: { mediaAnalysisEnabled: true },
    telegramFileApi: {
      getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
    },
    fetch: vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))) as typeof fetch,
    visionProvider: { describe },
    ocrProvider: { extractText }
  });

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      messageId: 2,
      text: '/read',
      entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      replyToMessageId: 90,
      replyToMediaSnapshot: {
        messageId: 90,
        mediaKind: 'photo',
        fileId: 'photo-file',
        fileUniqueId: 'photo-unique',
        mimeType: 'image/jpeg',
        fileSize: 3,
        durationSeconds: null,
        caption: null
      }
    })
  );

  expect(db.savedMediaArtifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        provider: 'cloudflare',
        artifactKind: 'vision_description'
      }),
      expect.objectContaining({
        provider: 'deepseek',
        artifactKind: 'vision_interpretation'
      })
    ])
  );
  expect(db.savedMediaArtifacts).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        provider: 'ocr_space'
      })
    ])
  );
  expect(replyDispatcher).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'Описание картинки' })
  );
});
```

- [ ] **Step 2: Write failing test that OCR-only success continues**

Add:

```ts
test('continues when Cloudflare fails but OCR succeeds', async () => {
  const db = new FakeDatabaseClient();
  const generateReply = vi.fn().mockResolvedValue(createReplyResult('ГОРЖУСЬ'));
  const replyDispatcher = vi.fn().mockResolvedValue({
    messageId: 1001,
    createdAt: '2026-04-03T12:00:30.000Z'
  });
  const describe = vi.fn().mockRejectedValue(new Error('Cloudflare down'));
  const extractText = vi.fn().mockResolvedValue({
    provider: 'ocr_space',
    providerModel: 'ocr.space/parse/image:OCREngine=2',
    text: 'ГОРЖУСЬ',
    language: 'rus',
    rawResponse: { ParsedResults: [{ ParsedText: 'ГОРЖУСЬ' }] }
  });
  const orchestrator = createOrchestrator({
    db,
    qwen: { generateReply },
    replyDispatcher,
    env: { mediaAnalysisEnabled: true },
    telegramFileApi: {
      getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
    },
    fetch: vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))) as typeof fetch,
    visionProvider: { describe },
    ocrProvider: { extractText }
  });

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      messageId: 2,
      text: '/read',
      entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      replyToMessageId: 90,
      replyToMediaSnapshot: {
        messageId: 90,
        mediaKind: 'photo',
        fileId: 'photo-file',
        fileUniqueId: 'photo-unique',
        mimeType: 'image/jpeg',
        fileSize: 3,
        durationSeconds: null,
        caption: null
      }
    })
  );

  expect(db.savedMediaArtifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        provider: 'ocr_space',
        artifactKind: 'ocr_text_ru',
        artifactText: 'ГОРЖУСЬ'
      }),
      expect.objectContaining({
        provider: 'deepseek',
        artifactKind: 'vision_interpretation'
      })
    ])
  );
  expect(replyDispatcher).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'ГОРЖУСЬ' })
  );
});
```

- [ ] **Step 3: Run fallback tests and verify RED or confirm existing GREEN**

Run:

```bash
npx vitest run tests/chat-orchestrator.test.ts -t "empty OCR|Cloudflare fails"
```

Expected before Task 4 implementation: fail. Expected after Task 4 implementation: pass or reveal missing fallback details.

- [ ] **Step 4: Fix fallback details if needed**

If either test fails, adjust only `generateAndStoreImageAnalysis` and `ensureImageMediaContext`:

```ts
const hasUsefulImageContext =
  Boolean(visionDescription) || Boolean(ocrTextRu) || Boolean(ocrTextDefault);

if (!hasUsefulImageContext) {
  return null;
}
```

Keep the empty OCR branch as:

```ts
const text = ocr.text.trim();

if (text.length === 0) {
  return;
}
```

- [ ] **Step 5: Run fallback tests and verify GREEN**

Run:

```bash
npx vitest run tests/chat-orchestrator.test.ts -t "empty OCR|Cloudflare fails"
```

Expected: fallback tests pass.

## Task 6: Cache Behavior

**Files:**
- Modify: `tests/chat-orchestrator.test.ts`
- Modify: `src/app/chat-orchestrator.ts`

- [ ] **Step 1: Write failing cache test**

Add:

```ts
test('reuses cached image OCR and vision description artifacts', async () => {
  const db = new FakeDatabaseClient();
  const now = '2026-04-13T09:00:10.000Z';
  db.saveMediaArtifact({
    fileUniqueId: 'photo-unique',
    chatId: 1,
    telegramMessageId: 90,
    mediaKind: 'photo',
    provider: 'cloudflare',
    providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
    artifactKind: 'vision_description',
    artifactStatus: 'success',
    artifactText: 'Cached visual description',
    artifactJson: { text: 'Cached visual description' },
    rawResponseJson: { response: 'Cached visual description' },
    sourceCaption: null,
    sourceMimeType: 'image/jpeg',
    sourceFileSize: 3,
    sourceDurationSeconds: null,
    recognitionLanguage: null,
    confidenceJson: null,
    errorText: null,
    createdAt: now,
    expiresAt: '2026-04-20T09:00:10.000Z'
  });
  db.saveMediaArtifact({
    fileUniqueId: 'photo-unique',
    chatId: 1,
    telegramMessageId: 90,
    mediaKind: 'photo',
    provider: 'ocr_space',
    providerModel: 'ocr.space/parse/image:OCREngine=2',
    artifactKind: 'ocr_text_ru',
    artifactStatus: 'success',
    artifactText: 'ГОРЖУСЬ',
    artifactJson: { text: 'ГОРЖУСЬ' },
    rawResponseJson: { ParsedResults: [{ ParsedText: 'ГОРЖУСЬ' }] },
    sourceCaption: null,
    sourceMimeType: 'image/jpeg',
    sourceFileSize: 3,
    sourceDurationSeconds: null,
    recognitionLanguage: 'rus',
    confidenceJson: null,
    errorText: null,
    createdAt: now,
    expiresAt: '2026-04-20T09:00:10.000Z'
  });
  db.saveMediaArtifact({
    fileUniqueId: 'photo-unique',
    chatId: 1,
    telegramMessageId: 90,
    mediaKind: 'photo',
    provider: 'ocr_space',
    providerModel: 'ocr.space/parse/image:OCREngine=2',
    artifactKind: 'ocr_text_default',
    artifactStatus: 'success',
    artifactText: 'ГОРЖУСЬ',
    artifactJson: { text: 'ГОРЖУСЬ' },
    rawResponseJson: { ParsedResults: [{ ParsedText: 'ГОРЖУСЬ' }] },
    sourceCaption: null,
    sourceMimeType: 'image/jpeg',
    sourceFileSize: 3,
    sourceDurationSeconds: null,
    recognitionLanguage: null,
    confidenceJson: null,
    errorText: null,
    createdAt: now,
    expiresAt: '2026-04-20T09:00:10.000Z'
  });
  const generateReply = vi.fn().mockResolvedValue(createReplyResult('ГОРЖУСЬ'));
  const describe = vi.fn();
  const extractText = vi.fn();
  const fetch = vi.fn();
  const orchestrator = createOrchestrator({
    db,
    qwen: { generateReply },
    replyDispatcher: vi.fn().mockResolvedValue({
      messageId: 1001,
      createdAt: '2026-04-03T12:00:30.000Z'
    }),
    env: { mediaAnalysisEnabled: true },
    telegramFileApi: {
      getFile: vi.fn().mockResolvedValue({ file_path: 'photo/file.jpg' })
    },
    fetch: fetch as typeof globalThis.fetch,
    visionProvider: { describe },
    ocrProvider: { extractText }
  });

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      messageId: 2,
      text: '/read',
      entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      replyToMessageId: 90,
      replyToMediaSnapshot: {
        messageId: 90,
        mediaKind: 'photo',
        fileId: 'photo-file',
        fileUniqueId: 'photo-unique',
        mimeType: 'image/jpeg',
        fileSize: 3,
        durationSeconds: null,
        caption: null
      }
    })
  );

  expect(fetch).not.toHaveBeenCalled();
  expect(describe).not.toHaveBeenCalled();
  expect(extractText).not.toHaveBeenCalled();
  expect(generateReply).toHaveBeenCalledWith(
    expect.objectContaining({
      mediaContext: expect.objectContaining({
        visionDescription: 'Cached visual description',
        ocrTextRu: 'ГОРЖУСЬ',
        ocrTextDefault: 'ГОРЖУСЬ'
      })
    })
  );
});
```

- [ ] **Step 2: Run cache test and verify RED or GREEN**

Run:

```bash
npx vitest run tests/chat-orchestrator.test.ts -t "reuses cached image OCR"
```

Expected: pass if Task 4 cache code is complete; otherwise fail because artifacts are not read.

- [ ] **Step 3: Fix cache reads if needed**

If the test fails, adjust `ensureImageMediaContext` to read all three artifacts before calling `generateAndStoreImageAnalysis`, using `getCachedImageArtifact` exactly once per artifact kind.

- [ ] **Step 4: Run cache test and verify GREEN**

Run:

```bash
npx vitest run tests/chat-orchestrator.test.ts -t "reuses cached image OCR"
```

Expected: cache test passes.

## Task 7: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`

- [ ] **Step 1: Update README media setup**

Modify README `/read` setup paragraph to include OCR.space:

```md
`/read` по умолчанию выключен: для распознавания медиа нужно явно включить `MEDIA_ANALYSIS_ENABLED=true` и задать `GLADIA_API_KEY`, `CLOUDFLARE_AI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `OCR_SPACE_API_KEY`.
```

Modify command description:

```md
- `/read` - лениво распознать replied-to медиа без интерпретации. В v1 поддержаны `photo`, image `document`, `voice`, `audio` и Telegram `video_note`: картинки идут через Cloudflare Workers AI для визуального описания и OCR.space для двух OCR-слоёв (`rus` и default), аудио и кружочки через Gladia, а финальный ответ форматирует `LLM_REPLY_MODEL`.
```

Add variable to list:

```md
- `OCR_SPACE_API_KEY`
```

- [ ] **Step 2: Update architecture docs**

In `docs/architecture.md`, add or update the media intake section with:

```md
Image media analysis stores separate artifacts:

- `vision_description` from Cloudflare Workers AI. This is visual description, not OCR.
- `ocr_text_ru` from OCR.space with `language=rus` and `OCREngine=2`.
- `ocr_text_default` from OCR.space with no language and `OCREngine=2`.

Empty OCR results are not stored. The image flow continues when at least one of these artifacts is available.
```

- [ ] **Step 3: Update development docs**

In `docs/development.md`, add OCR.space to local media testing notes:

```md
For image media analysis, local `.env` must include `OCR_SPACE_API_KEY` in addition to Cloudflare credentials. OCR.space smoke tests should use `OCREngine=2`; the default engine returned empty text for `data/test-medal-ru.jpg`.
```

- [ ] **Step 4: Run docs-adjacent tests**

Run:

```bash
npx vitest run tests/prompt-files.test.ts tests/llm-prompts.test.ts
```

Expected: docs edits do not affect prompt file registration; prompt tests still pass.

## Task 8: Final Verification

**Files:**
- No new files

- [ ] **Step 1: Run focused provider and orchestration tests**

Run:

```bash
npx vitest run tests/ocr-space-provider.test.ts tests/chat-orchestrator.test.ts tests/llm-prompts.test.ts tests/env.test.ts tests/app.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript exits successfully.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: Vitest exits successfully.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: TypeScript build exits successfully.

- [ ] **Step 5: Inspect git diff**

Run:

```bash
git diff --stat
git diff -- src/media/ocr-space-provider.ts src/media/types.ts src/config/env.ts src/app.ts src/app/chat-orchestrator.ts src/llm/prompts.ts llm/system/read.md llm/system/explain.md llm/system/answer.md README.md docs/architecture.md docs/development.md
```

Expected: diff contains only OCR image-flow, prompt context, env wiring, tests, and documentation changes.

## Self-Review Notes

- Spec coverage: the plan covers OCR.space `rus` and default requests, `OCREngine=2`, non-empty persistence only, Cloudflare separation, prompt separation, fallback behavior, app/env wiring, tests, and docs.
- Placeholder scan: no deferred implementation sections are left in the task list.
- Type consistency: runtime names are `ocrTextRu`, `ocrTextDefault`, and `visionDescription`; storage names are `ocr_text_ru`, `ocr_text_default`, and `vision_description`.
- Eval decision: intent eval fixtures do not need updates because command routing and intent classification do not change. Prompt and orchestrator tests cover the changed media behavior.
