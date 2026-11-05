import { expect, test } from 'vitest';
import { createAnswerFlow } from './support/answer-flow.js';

const plan = {
  mode: 'direct',
  discussions: [
    { id: 'database', messageIds: [1] },
    { id: 'trip', messageIds: [2] }
  ],
  inferredLinks: [],
  selectedDiscussionIds: ['database']
};

test('generates a direct answer in a second call with only the selected discussion', async () => {
  const flow = createAnswerFlow([
    plan,
    { mode: 'response', text: 'Нужны транзакции.' }
  ]);
  await flow.run('@fun_bot почему PostgreSQL?');
  expect(flow.requests).toHaveLength(2);
  const final = flow.requests[1]?.messages.find(
    (m) => m.role === 'user'
  )?.content;
  expect(final).toContain('PostgreSQL поддерживает транзакции');
  expect(final).not.toContain('На море едем поездом');
  expect(final).not.toContain('"trip"');
  expect(flow.search).not.toHaveBeenCalled();
  expect(flow.replyDispatcher).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'Нужны транзакции.' })
  );
});

test('generates a clarification from competing discussions without web search', async () => {
  const flow = createAnswerFlow([
    {
      ...plan,
      mode: 'clarify',
      ambiguity: 'База данных или поездка?',
      selectedDiscussionIds: ['database', 'trip']
    },
    { mode: 'response', text: 'Ты про базу данных или поездку?' }
  ]);
  await flow.run('@fun_bot почему так решили?');
  expect(flow.requests).toHaveLength(2);
  expect(flow.requests[1]?.messages[1]?.content).toContain(
    'База данных или поездка?'
  );
  expect(flow.search).not.toHaveBeenCalled();
  expect(flow.replyDispatcher).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'Ты про базу данных или поездку?' })
  );
});

test('research uses two calls and does not leak unselected graph metadata into evidence', async () => {
  const flow = createAnswerFlow([
    {
      ...plan,
      mode: 'research',
      resolvedQuestion: 'PostgreSQL сейчас?',
      purpose: 'freshness',
      focusClaim: 'Версия PostgreSQL',
      queries: ['PostgreSQL latest']
    },
    {
      mode: 'grounded',
      status: 'answered',
      outcome: 'confirmed',
      evidenceBasis: 'original_source',
      usedSourceIds: ['web_1'],
      text: 'Ответ по документации.'
    }
  ]);
  await flow.run();
  expect(flow.requests).toHaveLength(2);
  expect(flow.search).toHaveBeenCalledOnce();
  expect(flow.requests[1]?.messages[1]?.content).not.toContain('"trip"');
});
