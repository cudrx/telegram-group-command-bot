import {
  enrichContextWithMediaEvidence,
  type MediaEvidence
} from '../../src/app/chat-orchestrator/media/cache.js';
import { buildReplyContext } from '../../src/app/reply-context-builder.js';
import { answerActionConfig } from '../../src/config/runtime/index.js';
import type {
  ReplyGenerationIntent,
  StoredMessage
} from '../../src/domain/models.js';
import { formatMoscowCurrentDateTime } from '../../src/llm/current-datetime.js';
import { loadAssistantInstructions } from '../../src/llm/prompt-files.js';
import type { DescribeMediaContext } from '../../src/llm/prompts.js';
import type { IntentEvalFixture } from './types.js';

const DEFAULT_ASSISTANT_INSTRUCTIONS = loadAssistantInstructions();

export function createFixture(input: {
  id: string;
  intent: ReplyGenerationIntent;
  targetDisplayName: string;
  rows: Array<[string, string, string]>;
  triggerText: string;
  replyAnchorText?: string;
  replyAnchorIsBot?: boolean;
  replyToMessageId?: number;
  rowMetadata?: Record<
    number,
    Partial<
      Pick<
        StoredMessage,
        'userId' | 'isBot' | 'replyToMessageId' | 'mediaSnapshot'
      >
    >
  >;
  mediaArtifacts?: MediaEvidence[];
  expectedMode?: IntentEvalFixture['expectedMode'];
  expectedMessageIds?: number[];
  assistantInstructions?: string;
  lookupExpectation?: IntentEvalFixture['lookupExpectation'];
  mediaContext?: DescribeMediaContext;
  rubric: IntentEvalFixture['rubric'];
}): IntentEvalFixture {
  const authorIds = new Map(
    [...new Set(input.rows.map((row) => row[1]))].map((author, index) => [
      author,
      index + 1
    ])
  );
  const priorContextMessages = input.rows.map<StoredMessage>(
    ([createdAt, senderDisplayName, text], index) => ({
      chatId: 1,
      messageId: index + 1,
      userId: authorIds.get(senderDisplayName) ?? null,
      senderDisplayName,
      text,
      createdAt,
      isBot: false,
      replyToMessageId: null,
      ...input.rowMetadata?.[index + 1]
    })
  );
  const anchorMessageId = input.rows.length + 1;

  const fixture: IntentEvalFixture = {
    id: input.id,
    intent: input.intent,
    targetDisplayName: input.targetDisplayName,
    assistantInstructions:
      input.assistantInstructions ?? DEFAULT_ASSISTANT_INSTRUCTIONS,
    currentDateTime: formatMoscowCurrentDateTime(
      priorContextMessages.at(-1)?.createdAt ?? '2026-10-24T10:00:00Z'
    ),
    replyContext: {
      triggerMessage: {
        chatId: 1,
        messageId: input.rows.length + (input.replyAnchorText ? 2 : 1),
        userId: 999,
        senderDisplayName: input.targetDisplayName,
        text: input.triggerText,
        createdAt:
          priorContextMessages[priorContextMessages.length - 1]?.createdAt ??
          '2026-01-01T00:00:00.000Z',
        isBot: false,
        replyToMessageId:
          input.replyToMessageId ??
          (input.replyAnchorText ? anchorMessageId : null)
      },
      replyAnchorMessage:
        input.replyAnchorText && usesReplyAnchor(input.intent)
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

  if (input.expectedMode) fixture.expectedMode = input.expectedMode;
  if (input.expectedMessageIds)
    fixture.expectedMessageIds = input.expectedMessageIds;

  if (input.intent === 'answer') {
    const messages = [
      ...priorContextMessages,
      fixture.replyContext.replyAnchorMessage,
      fixture.replyContext.triggerMessage
    ].filter((message) => message !== null);
    fixture.replyContext = enrichContextWithMediaEvidence(
      buildReplyContext({
        db: {
          getMessageByTelegramMessageId: (chatId, id) =>
            messages.find(
              (message) => message.chatId === chatId && message.messageId === id
            ) ?? null,
          getMessagesBefore: (chatId, id, limit) =>
            messages
              .filter(
                (message) => message.chatId === chatId && message.messageId < id
              )
              .slice(-limit)
        },
        chatId: 1,
        triggerMessageId: input.rows.length + (input.replyAnchorText ? 2 : 1),
        contextLimit: answerActionConfig.contextLimit,
        intent: 'answer',
        botUserId: 77
      }),
      input.mediaArtifacts ?? []
    );
  }

  if (input.mediaContext) {
    fixture.mediaContext = input.mediaContext;
  }

  if (input.lookupExpectation) {
    fixture.lookupExpectation = input.lookupExpectation;
  }

  return fixture;
}

function usesReplyAnchor(intent: ReplyGenerationIntent): boolean {
  return intent === 'answer' || intent === 'translate';
}
