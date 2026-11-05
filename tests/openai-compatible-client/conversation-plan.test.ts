import { expect, test } from 'vitest';
import { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';
import { createClientConfig, createReplyInput } from './support.js';

const input = {
  ...createReplyInput(),
  replyContext: {
    ...createReplyInput().replyContext,
    triggerMessage: {
      chatId: 1,
      userId: 42,
      senderDisplayName: 'Tom',
      createdAt: '2026-04-03T12:02:00Z',
      isBot: false,
      replyToMessageId: null,
      messageId: 10,
      text: '@bot почему поезд?'
    },
    priorContextMessages: [
      {
        chatId: 1,
        messageId: 1,
        userId: 42,
        senderDisplayName: 'Tom',
        text: 'Поезд дешевле',
        createdAt: '2026-04-03T12:00:00Z',
        isBot: false,
        replyToMessageId: null
      },
      {
        chatId: 1,
        messageId: 2,
        userId: 42,
        senderDisplayName: 'Tom',
        text: 'Пицца пепперони',
        createdAt: '2026-04-03T12:01:00Z',
        isBot: false,
        replyToMessageId: null
      }
    ]
  }
};
const plan = {
  mode: 'direct' as const,
  discussions: [
    { id: 'trip', messageIds: [1] },
    { id: 'food', messageIds: [2] }
  ],
  inferredLinks: [],
  selectedDiscussionIds: ['trip']
};

function setup(replies: unknown[]) {
  const requests: Array<{
    messages: Array<{ role: string; content: string }>;
  }> = [];
  const client = new OpenAiCompatibleLlmClient(createClientConfig(), {
    chat: {
      completions: {
        create: async (request: (typeof requests)[number]) => {
          requests.push(structuredClone(request));
          const reply = replies.shift();
          if (reply instanceof Error) throw reply;
          return {
            choices: [
              {
                message: {
                  content:
                    typeof reply === 'string' ? reply : JSON.stringify(reply)
                }
              }
            ]
          };
        }
      }
    }
  } as never);
  return { client, requests };
}

test('plans discussions without writing an answer', async () => {
  const { client } = setup([plan]);
  expect((await client.generateAnswer(input)).decision).toEqual(plan);
});

test('final generation excludes unselected discussions and preserves the original request', async () => {
  const { client, requests } = setup([
    { mode: 'response', text: 'Из-за цены.' }
  ]);
  const result = await client.generateAnswer({ ...input, plan });
  expect(result.decision).toEqual({ mode: 'response', text: 'Из-за цены.' });
  const data = requests[0]?.messages.find((m) => m.role === 'user')?.content;
  expect(data).toContain('Поезд дешевле');
  expect(data).toContain('@bot почему поезд?');
  expect(data).not.toContain('Пицца пепперони');
  expect(data).not.toContain('food');
});

test.each([
  ['invalid JSON', '{'],
  [
    'unknown message',
    { ...plan, discussions: [{ id: 'trip', messageIds: [999] }] }
  ],
  ['unknown discussion', { ...plan, selectedDiscussionIds: ['missing'] }],
  ['forward inferred link', { ...plan, inferredLinks: [{ from: 1, to: 2 }] }],
  [
    'cross-discussion inferred link',
    { ...plan, inferredLinks: [{ from: 2, to: 1 }] }
  ]
])('repairs %s once against the same candidate snapshot', async (_name, invalid) => {
  const { client, requests } = setup([invalid, plan]);
  const result = await client.generateAnswer(input);
  expect(result.decision).toEqual(plan);
  expect(result.attemptCount).toBe(2);
  expect(requests).toHaveLength(2);
  expect(requests[1]?.messages[1]).toEqual(requests[0]?.messages[1]);
  expect(requests[1]?.messages.at(-1)?.content).toContain('VALIDATION_ERROR');
});

test('stops after one failed repair instead of generating from an invalid graph', async () => {
  const { client, requests } = setup(['{', '{', plan]);
  await expect(client.generateAnswer(input)).rejects.toThrow();
  expect(requests).toHaveLength(2);
});

test('does not repair authentication errors', async () => {
  const { client, requests } = setup([
    Object.assign(new Error('unauthorized'), { status: 401 }),
    plan
  ]);
  await expect(client.generateAnswer(input)).rejects.toThrow('unauthorized');
  expect(requests).toHaveLength(1);
});

test('a reply topic switch does not pull an unselected parent into the final answer', async () => {
  const { client, requests } = setup([
    { mode: 'response', text: 'Пепперони.' }
  ]);
  await client.generateAnswer({
    ...input,
    plan: { ...plan, selectedDiscussionIds: ['food'] },
    replyContext: {
      ...input.replyContext,
      priorContextMessages: [
        {
          ...input.replyContext.triggerMessage,
          messageId: 1,
          text: 'Поезд дешевле'
        },
        {
          ...input.replyContext.triggerMessage,
          messageId: 2,
          text: 'Пицца пепперони',
          replyToMessageId: 1
        }
      ]
    }
  });
  const data = requests[0]?.messages[1]?.content;
  expect(data).toContain('Пицца пепперони');
  expect(data).not.toContain('Поезд дешевле');
});

test('accounts for discussion metadata when fitting the final prompt budget', async () => {
  const { buildAnswerMessages } = await import(
    '../../src/llm/openai-compatible-client/answer.js'
  );
  const { estimateTokens } = await import(
    '../../src/llm/openai-compatible-client/logging.js'
  );
  const rows = Array.from({ length: 40 }, (_, index) => ({
    ...input.replyContext.triggerMessage,
    messageId: index + 1,
    text: 'evidence '.repeat(100)
  }));
  const messages = buildAnswerMessages({
    ...input,
    assistantInstructions: 'policy '.repeat(4200),
    replyContext: {
      ...input.replyContext,
      triggerMessage: { ...input.replyContext.triggerMessage, messageId: 100 },
      priorContextMessages: rows
    },
    plan: {
      ...plan,
      discussions: [
        {
          id: 'a-long-discussion-id-that-must-fit',
          messageIds: rows.map((row) => row.messageId)
        }
      ],
      selectedDiscussionIds: ['a-long-discussion-id-that-must-fit']
    }
  });
  expect(
    estimateTokens(messages.map((m) => m.content).join('\n\n'))
  ).toBeLessThanOrEqual(16000);
});

test('transport retries are not reset when repairing a model response', async () => {
  const outage = () =>
    Object.assign(new Error('temporary outage'), { status: 500 });
  const { client, requests } = setup([outage(), '{', outage(), plan]);
  await expect(client.generateAnswer(input)).rejects.toThrow(
    'temporary outage'
  );
  expect(requests).toHaveLength(3);
});

test('repairs invalid final source IDs without restarting the planner', async () => {
  const grounded = {
    mode: 'grounded',
    status: 'answered',
    outcome: 'confirmed',
    evidenceBasis: 'original_source',
    usedSourceIds: ['web_1'],
    text: 'По источнику.'
  };
  const { client, requests } = setup([
    { ...grounded, usedSourceIds: ['unknown'] },
    grounded
  ]);
  const result = await client.generateAnswer({
    ...input,
    plan,
    research: {
      plan: {
        resolvedQuestion: 'Вопрос',
        purpose: 'fact_check',
        focusClaim: 'Факт',
        queries: ['query']
      },
      result: {
        queries: ['query'],
        sources: [
          {
            id: 'web_1',
            query: 'query',
            title: 'Source',
            url: 'https://example.com',
            content: 'Evidence',
            score: null
          }
        ]
      }
    }
  });
  expect(result.decision).toEqual(grounded);
  expect(result.attemptCount).toBe(2);
  expect(requests).toHaveLength(2);
});

test('removes CURRENT_REQUEST from the graph without retrying or losing history', async () => {
  const { client, requests } = setup([
    {
      ...plan,
      discussions: [
        { id: 'trip', messageIds: [1, 10] },
        { id: 'request-only', messageIds: [10] }
      ],
      inferredLinks: [{ from: 10, to: 1 }],
      selectedDiscussionIds: ['trip', 'request-only']
    }
  ]);
  const result = await client.generateAnswer(input);
  expect(result.decision).toEqual({
    mode: 'direct',
    discussions: [{ id: 'trip', messageIds: [1] }],
    inferredLinks: [],
    selectedDiscussionIds: ['trip']
  });
  expect(requests).toHaveLength(1);
});

test('removes inferred duplicates of explicit replies without retrying or changing reply metadata', async () => {
  const context = {
    ...input.replyContext,
    priorContextMessages: input.replyContext.priorContextMessages.map(
      (message) => ({
        ...message,
        replyToMessageId: message.messageId === 2 ? 1 : null
      })
    )
  };
  const { client, requests } = setup([
    {
      mode: 'direct',
      discussions: [{ id: 'one', messageIds: [1, 2] }],
      selectedDiscussionIds: ['one'],
      inferredLinks: [{ from: 2, to: 1 }]
    }
  ]);
  const result = await client.generateAnswer({
    ...input,
    replyContext: context
  });
  expect(result.decision).toHaveProperty('inferredLinks', []);
  expect(context.priorContextMessages[1]?.replyToMessageId).toBe(1);
  expect(requests).toHaveLength(1);
});

test('still rejects unknown IDs after removing CURRENT_REQUEST', async () => {
  const invalid = {
    ...plan,
    discussions: [{ id: 'trip', messageIds: [10, 999] }]
  };
  const { client, requests } = setup([invalid, invalid]);
  await expect(client.generateAnswer(input)).rejects.toThrow('999');
  expect(requests).toHaveLength(2);
});

test('repairs an overlong clarification instead of sending a paragraph of advice', async () => {
  const { client, requests } = setup([
    {
      mode: 'response',
      text: 'Подробное объяснение без нужного уточнения. '.repeat(12)
    },
    { mode: 'response', text: 'Что именно не работает?' }
  ]);
  const result = await client.generateAnswer({
    ...input,
    plan: { ...plan, mode: 'clarify', ambiguity: 'Не указан предмет сбоя' }
  });
  expect(result.decision).toEqual({
    mode: 'response',
    text: 'Что именно не работает?'
  });
  expect(requests).toHaveLength(2);
  expect(requests[1]?.messages.at(-1)?.content).toContain('240');
});

test('does not let request-only groups hide a duplicate discussion ID and drop selected history', async () => {
  const { client, requests } = setup([
    {
      ...plan,
      discussions: [
        { id: 'trip', messageIds: [1] },
        { id: 'trip', messageIds: [10] }
      ]
    },
    plan
  ]);
  const result = await client.generateAnswer(input);
  expect(result.decision).toEqual(plan);
  expect(result.attemptCount).toBe(2);
  expect(requests).toHaveLength(2);
});
