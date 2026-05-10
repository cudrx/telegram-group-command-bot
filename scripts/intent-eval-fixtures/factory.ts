import { readFileSync } from 'node:fs';

import type {
  AssistantIntent,
  StoredMessage
} from '../../src/domain/models.js';
import type { DescribeMediaContext } from '../../src/llm/prompts.js';
import type { IntentEvalFixture } from './types.js';

const DEFAULT_ASSISTANT_INSTRUCTIONS = readFileSync(
  'llm/assistant/base.md',
  'utf8'
).trim();

export function createFixture(input: {
  id: string;
  intent: AssistantIntent;
  targetDisplayName: string;
  rows: Array<[string, string, string]>;
  triggerText: string;
  replyAnchorText?: string;
  replyAnchorIsBot?: boolean;
  assistantInstructions?: string;
  lookupExpectation?: IntentEvalFixture['lookupExpectation'];
  mediaContext?: DescribeMediaContext;
  rubric: IntentEvalFixture['rubric'];
}): IntentEvalFixture {
  const priorContextMessages = input.rows.map<StoredMessage>(
    ([createdAt, senderDisplayName, text], index) => ({
      chatId: 1,
      messageId: index + 1,
      userId: index + 1,
      senderDisplayName,
      text,
      createdAt,
      isBot: senderDisplayName.toLowerCase().includes('бот'),
      replyToMessageId: null
    })
  );
  const anchorMessageId = 10_000;

  const fixture: IntentEvalFixture = {
    id: input.id,
    intent: input.intent,
    targetDisplayName: input.targetDisplayName,
    assistantInstructions:
      input.assistantInstructions ?? DEFAULT_ASSISTANT_INSTRUCTIONS,
    currentDateTime: 'Sunday, 10 May 2026, 19:09 Moscow time',
    replyContext: {
      triggerMessage: {
        chatId: 1,
        messageId: input.rows.length + 1,
        userId: 999,
        senderDisplayName: input.targetDisplayName,
        text: input.triggerText,
        createdAt:
          priorContextMessages[priorContextMessages.length - 1]?.createdAt ??
          '2026-01-01T00:00:00.000Z',
        isBot: false,
        replyToMessageId: input.replyAnchorText ? anchorMessageId : null
      },
      replyAnchorMessage:
        input.replyAnchorText && input.intent === 'answer'
          ? {
              chatId: 1,
              messageId: anchorMessageId,
              userId: 555,
              senderDisplayName: 'Anchor User',
              text: input.replyAnchorText,
              createdAt:
                priorContextMessages[priorContextMessages.length - 1]
                  ?.createdAt ?? '2026-01-01T00:00:00.000Z',
              isBot: input.replyAnchorIsBot ?? false,
              replyToMessageId: null
            }
          : null,
      priorContextMessages
    },
    rubric: input.rubric
  };

  if (input.mediaContext) {
    fixture.mediaContext = input.mediaContext;
  }

  if (input.lookupExpectation) {
    fixture.lookupExpectation = input.lookupExpectation;
  }

  return fixture;
}
