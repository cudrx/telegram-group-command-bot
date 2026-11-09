import { expect, test, vi } from 'vitest';

import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import { createClientConfig, createReplyInput } from './support.js';

function setup(content: string) {
  const create = vi
    .fn()
    .mockResolvedValue({ choices: [{ message: { content } }] });
  const llm = new OpenAiCompatibleLlmClient(createClientConfig(), {
    chat: { completions: { create } }
  } as never);
  const trigger = createReplyInput().replyContext.triggerMessage;
  if (!trigger) throw new Error('Missing trigger fixture');

  const input = {
    assistantInstructions: 'Assistant instructions',
    draft: 'сервер ушёл за пельменями',
    currentDateTime: 'now',
    messages: [trigger]
  };

  return { llm, create, input };
}

test('adapts draft and real context in exactly one JSON request', async () => {
  const { llm, create, input } = setup(
    '{"action":"send","text":"сервер опять варит прод"}'
  );
  const result = await llm.generateSpontaneous(input);
  expect(result.decision).toEqual({
    action: 'send',
    text: 'сервер опять варит прод'
  });
  expect(result.attemptCount).toBe(1);
  expect(create).toHaveBeenCalledTimes(1);
  const request = create.mock.calls[0]?.[0];
  expect(request.messages[1].content).toContain(input.draft);
  expect(request.messages[1].content).toContain('/decide кто прав');
  expect(
    request.messages.map((message: { role: string }) => message.role)
  ).toEqual(['system', 'user']);
  expect(request.response_format).toEqual({ type: 'json_object' });
});

test.each([
  '{"action":"skip"}',
  'plain unvalidated output',
  '{"action":"send","text":""}',
  JSON.stringify({ action: 'send', text: 'a'.repeat(401) }),
  '{"action":"send","text":"hello","extra":true}',
  ''
])('declines skip or malformed output without repair calls: %s', async (content) => {
  const { llm, create, input } = setup(content);
  expect((await llm.generateSpontaneous(input)).decision).toEqual({
    action: 'skip'
  });
  expect(create).toHaveBeenCalledTimes(1);
});

test('does not retry provider errors even when normal replies allow retries', async () => {
  const { llm, create, input } = setup('');
  create.mockRejectedValue(
    Object.assign(new Error('rate limited'), { status: 429 })
  );
  await expect(llm.generateSpontaneous(input)).rejects.toThrow('rate limited');
  expect(create).toHaveBeenCalledTimes(1);
});
