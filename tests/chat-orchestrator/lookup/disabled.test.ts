import { expect, test } from 'vitest';

import { createAnswerFlow } from '../support/answer-flow.js';

test('a summary request can be answered in one completion without lookup', async () => {
  const flow = createAnswerFlow([
    {
      mode: 'direct',
      context: { messageIds: [1, 2] },
      text: 'Обсуждали базу и поездку.'
    }
  ]);
  await flow.run('@fun_bot подведи итог обоих обсуждений');
  expect(flow.requests).toHaveLength(1);
  expect(flow.search).not.toHaveBeenCalled();
  expect(flow.replyDispatcher).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: 'Обсуждали базу и поездку.' })
  );
});

test('clarification does not trigger lookup or additional history resolution', async () => {
  const flow = createAnswerFlow([
    {
      mode: 'clarify',
      context: { messageIds: [] },
      text: 'О каком обсуждении речь?'
    }
  ]);
  await flow.run('@fun_bot почему так?');
  expect(flow.requests).toHaveLength(1);
  expect(flow.search).not.toHaveBeenCalled();
  expect(flow.replyDispatcher).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: 'О каком обсуждении речь?' })
  );
});

test('research without a configured provider returns the existing verification fallback', async () => {
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
    { lookupDisabled: true }
  );
  await flow.run();
  expect(flow.requests).toHaveLength(1);
  expect(flow.search).not.toHaveBeenCalled();
  expect(flow.replyDispatcher).toHaveBeenLastCalledWith(
    expect.objectContaining({
      text: 'Не смог быстро проверить это по внешним источникам.'
    })
  );
});
