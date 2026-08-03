import { describe, expect, test } from 'vitest';

import { buildIntentPrompt } from '../../src/llm/prompts.js';

describe('buildIntentPrompt chat intent inputs', () => {
  test.each([
    'summarize',
    'decide'
  ] as const)('selects %s mode without treating command arguments as chat data', (intent) => {
    const prompt = buildIntentPrompt({
      assistantInstructions: 'custom assistant instructions',
      targetDisplayName: 'Tom',
      intent,
      currentDateTime: 'Sunday, 10 May 2026, 19:09 Moscow time',
      replyContext: {
        triggerMessage: {
          chatId: 1,
          messageId: 3,
          userId: 1,
          senderDisplayName: 'Tom',
          text: `/${intent} command-only-secret`,
          createdAt: '2026-04-03T12:00:00.000Z',
          isBot: false,
          replyToMessageId: null
        },
        replyAnchorMessage: null,
        priorContextMessages: [
          {
            chatId: 1,
            messageId: 2,
            userId: 2,
            senderDisplayName: 'Alice',
            text: 'visible chat evidence',
            createdAt: '2026-04-03T11:59:00.000Z',
            isBot: false,
            replyToMessageId: null
          }
        ]
      }
    });

    expect(prompt).toContain('visible chat evidence');
    expect(prompt).not.toContain('command-only-secret');
  });

  test('uses the replied-to message as translate input', () => {
    const prompt = buildIntentPrompt({
      assistantInstructions: 'custom assistant instructions',
      targetDisplayName: 'Tom',
      intent: 'translate',
      currentDateTime: 'Sunday, 10 May 2026, 19:09 Moscow time',
      replyContext: {
        triggerMessage: {
          chatId: 1,
          messageId: 3,
          userId: 1,
          senderDisplayName: 'Tom',
          text: '/translate command-only-secret',
          createdAt: '2026-04-03T12:00:00.000Z',
          isBot: false,
          replyToMessageId: 2
        },
        replyAnchorMessage: {
          chatId: 1,
          messageId: 2,
          userId: 2,
          senderDisplayName: 'Alice',
          text: 'Hello world',
          createdAt: '2026-04-03T11:59:00.000Z',
          isBot: false,
          replyToMessageId: null
        },
        priorContextMessages: []
      }
    });

    expect(prompt).toContain('Hello world');
    expect(prompt).not.toContain('command-only-secret');
  });
});
