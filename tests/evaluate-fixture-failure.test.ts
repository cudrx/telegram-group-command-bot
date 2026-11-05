import { expect, test } from 'vitest';
import { evaluateFixture } from '../scripts/evaluate-intents/runner.js';
import { getEvalStatus } from '../scripts/evaluate-intents/scoring.js';
import { intentEvalFixtures } from '../scripts/intent-eval-fixtures.js';
import { OpenAiCompatibleLlmClient } from '../src/llm/openai-compatible-client/index.js';
import { createClientConfig } from './openai-compatible-client/support.js';

test('records an exhausted model failure and can evaluate the next fixture', async () => {
  const fixture = intentEvalFixtures.find(
    (item) => item.id === 'conversation-missing-subject'
  );
  if (!fixture) throw new Error('Missing fixture');
  const replies = [
    '{',
    '{',
    JSON.stringify({
      mode: 'clarify',
      discussions: [{ id: 'one', messageIds: [1, 2] }],
      inferredLinks: [],
      selectedDiscussionIds: ['one'],
      ambiguity: 'Не указано, что не работает'
    }),
    JSON.stringify({ mode: 'response', text: 'Что именно не работает?' })
  ];
  const provider = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: replies.shift() } }]
        })
      }
    }
  };
  const llm = new OpenAiCompatibleLlmClient(
    createClientConfig(),
    provider as never
  );
  const failed = await evaluateFixture(provider as never, llm, fixture, {
    llmReplyModel: 'reply-model',
    llmReplyTemperature: 0.6
  });
  expect(failed.error).toHaveProperty('name', 'SyntaxError');
  expect(getEvalStatus(failed)).toBe('failed');
  const next = await evaluateFixture(provider as never, llm, fixture, {
    llmReplyModel: 'reply-model',
    llmReplyTemperature: 0.6
  });
  expect(next.error).toBeUndefined();
  expect(next.response).toBe('Что именно не работает?');
  expect(next.conversation?.llmCalls).toBe(2);
});

test('utility fixtures retain the configured model after error-isolation refactoring', async () => {
  const fixture = intentEvalFixtures.find(
    (item) => item.id === 'translate-basic-message'
  );
  if (!fixture) throw new Error('Missing translate fixture');
  const provider = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: 'Перевод сообщения.' } }]
        })
      }
    }
  };
  const llm = new OpenAiCompatibleLlmClient(
    createClientConfig(),
    provider as never
  );
  const result = await evaluateFixture(provider as never, llm, fixture, {
    llmReplyModel: 'reply-model',
    llmReplyTemperature: 0.6
  });
  expect(result.error).toBeUndefined();
  expect(result.response).toBe('Перевод сообщения.');
});
