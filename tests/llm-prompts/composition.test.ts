import { describe, expect, test } from 'vitest';

import { buildIntentPrompt } from '../../src/llm/prompts.js';
import { createPromptReplyContext } from './support.js';

describe('buildIntentPrompt composition', () => {
  test.each([
    'summarize',
    'decide',
    'read',
    'answer'
  ] as const)('includes the supplied current time for %s', (intent) => {
    const currentDateTime =
      'Monday, 11 May 2026, 00:41 Moscow time unique-value';
    const prompt = buildIntentPrompt({
      assistantInstructions: 'custom assistant instructions',
      targetDisplayName: 'Tom',
      intent,
      currentDateTime,
      replyContext: createPromptReplyContext(`/${intent}`)
    });

    expect(prompt).toContain(currentDateTime);
  });

  test('uses the replied-to message for answer and excludes command arguments', () => {
    const prompt = buildIntentPrompt({
      assistantInstructions: 'custom assistant instructions',
      targetDisplayName: 'Tom',
      intent: 'answer',
      currentDateTime: 'Sunday, 10 May 2026, 19:09 Moscow time',
      replyContext: {
        triggerMessage: {
          chatId: 1,
          messageId: 3,
          userId: 1,
          senderDisplayName: 'Tom',
          text: '/answer command-only-secret',
          createdAt: '2026-04-03T12:00:00.000Z',
          isBot: false,
          replyToMessageId: 2
        },
        replyAnchorMessage: {
          chatId: 1,
          messageId: 2,
          userId: 5,
          senderDisplayName: 'Хачик',
          text: 'unique replied-to question',
          createdAt: '2026-04-03T12:00:00.000Z',
          isBot: false,
          replyToMessageId: null
        },
        priorContextMessages: []
      }
    });

    expect(prompt).toContain('unique replied-to question');
    expect(prompt).not.toContain('command-only-secret');
  });
});
