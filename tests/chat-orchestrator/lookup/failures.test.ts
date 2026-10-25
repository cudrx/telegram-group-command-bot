import { expect, test } from 'vitest';

import { createAnswerFlow } from '../support/answer-flow.js';

test.each([
  ['malformed JSON', '{broken'],
  [
    'unavailable message ID',
    { mode: 'direct', context: { messageIds: [9000] }, text: 'Wrong answer' }
  ],
  [
    'model timeout',
    Object.assign(new Error('timeout'), { name: 'APIConnectionTimeoutError' })
  ],
  [
    'unsupported history retrieval',
    { mode: 'retrieve_more', context: { messageIds: [] } }
  ]
])('fails safely without search or another completion after %s', async (_name, reply) => {
  const flow = createAnswerFlow([reply]);
  await flow.run();
  expect(flow.requests).toHaveLength(1);
  expect(flow.search).not.toHaveBeenCalled();
  expect(flow.replyDispatcher).toHaveBeenLastCalledWith(
    expect.objectContaining({
      text: 'Не получилось ответить. Попробуй ещё раз.'
    })
  );
});

test('a failed required lookup does not generate an ungrounded answer', async () => {
  const flow = createAnswerFlow(
    [
      {
        mode: 'research',
        context: { messageIds: [1] },
        resolvedQuestion: 'Вопрос',
        purpose: 'fact_check',
        focusClaim: 'Факт',
        queries: ['PostgreSQL docs']
      }
    ],
    {
      search: async () => {
        throw new Error('network down');
      }
    }
  );
  await flow.run();
  expect(flow.requests).toHaveLength(1);
  expect(flow.replyDispatcher).toHaveBeenLastCalledWith(
    expect.objectContaining({
      text: 'Не смог быстро проверить это по внешним источникам.'
    })
  );
});
