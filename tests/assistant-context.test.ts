import { expect, test } from 'vitest';

import { buildReplyContext } from '../src/app/reply-context-builder.js';
import { answerActionConfig } from '../src/config/runtime/index.js';
import { buildAnswerMessages } from '../src/llm/openai-compatible-client/answer.js';
import { estimateTokens } from '../src/llm/openai-compatible-client/logging.js';
import {
  createIncomingMessage,
  FakeDatabaseClient
} from './chat-orchestrator/support.js';

test('retrieves an old target and its real ancestors outside the recent window', () => {
  const db = new FakeDatabaseClient();
  for (let messageId = 1; messageId <= 50; messageId++) {
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId,
        text: messageId === 1 ? 'Мамонты — жертвы скама.' : 'другая тема',
        replyToMessageId: messageId === 2 ? 1 : null
      })
    );
  }
  db.saveIncomingMessage(
    createIncomingMessage({
      messageId: 51,
      text: '@fun_bot почему?',
      replyToMessageId: 2
    })
  );
  const context = buildReplyContext({
    db,
    chatId: 1,
    triggerMessageId: 51,
    contextLimit: 12,
    intent: 'answer',
    botUserId: 77
  });
  expect(context.replyAnchorMessage?.messageId).toBe(2);
  expect(context.priorContextMessages.map((m) => m.messageId)).toContain(1);
  expect(context.priorContextMessages.length).toBeLessThanOrEqual(12);
  expect(
    new Set(context.priorContextMessages.map((m) => m.messageId)).size
  ).toBe(context.priorContextMessages.length);
});

test('a mention request is not replaced by the preceding message', () => {
  const db = new FakeDatabaseClient();
  db.saveIncomingMessage(
    createIncomingMessage({ messageId: 1, text: 'пицца' })
  );
  db.saveIncomingMessage(
    createIncomingMessage({ messageId: 2, text: '@fun_bot сколько будет 2+2?' })
  );
  const context = buildReplyContext({
    db,
    chatId: 1,
    triggerMessageId: 2,
    contextLimit: 10,
    intent: 'answer',
    botUserId: 77
  });
  expect(context.replyAnchorMessage).toBeNull();
  expect(context.triggerMessage?.text).toBe('@fun_bot сколько будет 2+2?');
});

test('limits large multilingual history and marks omissions without losing the request', () => {
  const db = new FakeDatabaseClient();
  for (let messageId = 1; messageId <= 150; messageId++) {
    db.saveIncomingMessage(
      createIncomingMessage({
        messageId,
        text: 'Очень длинное сообщение '.repeat(1000)
      })
    );
  }
  db.saveIncomingMessage(
    createIncomingMessage({ messageId: 151, text: '@fun_bot подведи итог' })
  );
  const context = buildReplyContext({
    db,
    chatId: 1,
    triggerMessageId: 151,
    contextLimit: 80,
    intent: 'answer',
    botUserId: 77
  });
  expect(context.contextMetadata?.truncated).toBe(true);
  expect(
    estimateTokens(
      buildAnswerMessages({
        assistantInstructions: '',
        currentDateTime: 'now',
        replyContext: context
      })[1]?.content ?? ''
    )
  ).toBeLessThanOrEqual(answerActionConfig.context.maxPromptTokens);
  expect(context.triggerMessage?.text).toBe('@fun_bot подведи итог');
});
