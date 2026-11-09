import { expect, test, vi } from 'vitest';

import { evaluateFixture } from '../scripts/evaluate-intents/runner.js';
import { getEvalStatus } from '../scripts/evaluate-intents/scoring.js';
import { createFixture } from '../scripts/intent-eval-fixtures/factory.js';
import { OpenAiCompatibleLlmClient } from '../src/llm/openai-compatible-client/index.js';
import { createClientConfig } from './openai-compatible-client/support.js';

test.each([
  ['{"action":"skip"}', 'passed'],
  ['malformed', 'failed'],
  ['{"action":"send","text":"неуместная шутка"}', 'failed']
])('eval distinguishes deliberate silence from invalid output: %s', async (content, status) => {
  const fixture = {
    ...createFixture({
      id: 'test-silence',
      intent: 'answer',
      targetDisplayName: 'Алиса',
      rows: [],
      triggerText: 'серьёзный разговор',
      rubric: { mustIncludeAny: [], mustNotIncludeAny: [] }
    }),
    intent: 'spontaneous' as const,
    spontaneousDraft: 'кот варит сервер',
    expectedSpontaneousAction: 'skip' as const
  };
  const create = vi
    .fn()
    .mockResolvedValue({ choices: [{ message: { content } }] });
  const llm = new OpenAiCompatibleLlmClient(createClientConfig(), {
    chat: { completions: { create } }
  } as never);
  const result = await evaluateFixture(llm, fixture);
  expect(getEvalStatus(result)).toBe(status);
  expect(result.spontaneous?.llmCalls).toBe(1);
  expect(create).toHaveBeenCalledTimes(1);
});
