import { expect, test } from 'vitest';

import { createAnswerFlow } from '../support/answer-flow.js';

test.each([
  { shape: 'object', context: { messageIds: [1] } },
  { shape: 'array', context: [1] }
])('research generation receives only the selected discussion and web evidence with $shape context', async ({
  context
}) => {
  const flow = createAnswerFlow([
    {
      mode: 'research',
      context,
      resolvedQuestion: 'Есть ли транзакции в PostgreSQL?',
      purpose: 'fact_check',
      focusClaim: 'PostgreSQL поддерживает транзакции',
      queries: ['PostgreSQL transactions docs']
    },
    {
      mode: 'grounded',
      status: 'answered',
      outcome: 'confirmed',
      evidenceBasis: 'original_source',
      usedSourceIds: ['web_1'],
      text: 'Да, поддерживает.'
    }
  ]);
  await flow.run();
  expect(flow.requests).toHaveLength(2);
  expect(flow.search).toHaveBeenCalledWith({
    query: 'PostgreSQL transactions docs',
    maxResults: 3,
    timeoutMs: 7000
  });
  expect(flow.requests[0]?.messages[1]?.content).toContain(
    'На море едем поездом'
  );
  expect(flow.requests[1]?.messages[1]?.content).not.toContain(
    'На море едем поездом'
  );
  expect(flow.requests[1]?.messages[1]?.content).toContain(
    'PostgreSQL поддерживает транзакции'
  );
  expect(flow.requests[1]?.messages[1]?.content).toContain(
    'Transactions are supported.'
  );
  expect(flow.replyDispatcher).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: 'Да, поддерживает.' })
  );
});
