import { expect, test } from 'vitest';
import { evaluateAnswer } from '../scripts/evaluate-intents/runner.js';
import { intentEvalFixtures } from '../scripts/intent-eval-fixtures.js';
import { OpenAiCompatibleLlmClient } from '../src/llm/openai-compatible-client/index.js';
import { createClientConfig } from './openai-compatible-client/support.js';

test.each([
  true,
  false
])('eval runs both calls and scores inferred links (correct=%s)', async (correct) => {
  const fixture = intentEvalFixtures.find(
    (item) => item.id === 'conversation-implicit-links-interleaved'
  );
  if (!fixture) throw new Error('Missing implicit-link fixture');
  const replies = [
    {
      mode: 'direct',
      discussions: [{ id: 'gpu', messageIds: [1, 3, 5, 6] }],
      selectedDiscussionIds: ['gpu'],
      inferredLinks: correct
        ? [
            { from: 3, to: 1 },
            { from: 6, to: 5 }
          ]
        : []
    },
    { mode: 'response', text: '1440p, 16 ГБ, до 60 тысяч.' }
  ];
  const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(replies.shift()) } }]
        })
      }
    }
  } as never);
  const result = await evaluateAnswer(client, fixture);
  expect(result.conversation.llmCalls).toBe(2);
  expect(result.conversation.graphPassed).toBe(correct);
  expect(result.conversation.passed).toBe(correct);
  expect(result.response).toContain('60');
  expect(result.fittedMessages[1]?.content).not.toContain('Пепперони');
});
