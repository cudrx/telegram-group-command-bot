import { describe, expect, test } from 'vitest';

import {
  chatOrchestratorConstructor,
  cloudflareVisionConstructor,
  createEnv,
  gladiaConstructor,
  importCreateApplication,
  installAppTestHooks,
  llmConstructor,
  ocrSpaceConstructor,
  tavilyConstructor
} from './support.js';

describe('createApplication providers', () => {
  installAppTestHooks();

  test('wires planner model and Tavily lookup provider when a key is configured', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(
      createEnv({
        llmPlannerModel: 'planner-model',
        lookupProvider: 'tavily',
        tavilyApiKey: 'tvly-key',
        lookupTimeoutMs: 7000,
        lookupMaxQueries: 1,
        lookupMaxResults: 3
      })
    );

    expect(llmConstructor).toHaveBeenCalledWith(
      {
        apiKey: 'llm-key',
        baseUrl: 'https://example.com',
        replyModel: 'reply-model',
        replyTemperature: 0.6,
        plannerModel: 'planner-model',
        lookupMaxQueries: 1,
        timeoutMs: 20_000,
        maxRetries: 1
      },
      undefined,
      expect.any(Object)
    );
    expect(tavilyConstructor).toHaveBeenCalledWith({ apiKey: 'tvly-key' });
    expect(chatOrchestratorConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupProvider: expect.objectContaining({
          search: expect.any(Function)
        })
      })
    );
  });

  test('wires media providers when provider keys are configured', async () => {
    const { createApplication } = await importCreateApplication();
    await createApplication(
      createEnv({
        ocrSpaceApiKey: 'ocr-key',
        gladiaApiKey: 'gladia-key',
        cloudflareAiApiKey: 'cf-key',
        cloudflareAccountId: 'cf-account'
      })
    );

    expect(gladiaConstructor).toHaveBeenCalledWith({ apiKey: 'gladia-key' });
    expect(ocrSpaceConstructor).toHaveBeenCalledWith({ apiKey: 'ocr-key' });
    expect(cloudflareVisionConstructor).toHaveBeenCalledWith({
      accountId: 'cf-account',
      apiKey: 'cf-key'
    });
    expect(chatOrchestratorConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        speechToTextProvider: expect.objectContaining({
          transcribe: expect.any(Function)
        }),
        ocrProvider: expect.objectContaining({
          extractText: expect.any(Function)
        }),
        visionProvider: expect.objectContaining({
          describe: expect.any(Function)
        }),
        telegramFileApi: expect.objectContaining({
          getFile: expect.any(Function)
        }),
        fetch: expect.any(Function)
      })
    );
  });
});
