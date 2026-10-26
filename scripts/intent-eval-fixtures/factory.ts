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
  evaluation?: IntentEvalFixture['evaluation'];
  rubric: IntentEvalFixture['rubric'];
}): IntentEvalFixture {
  const authorIds = new Map(
    [
      ...new Set([...input.rows.map((row) => row[1]), input.targetDisplayName])
    ].map((author, index) => [author, index + 1])
  );
  for (const [index, row] of input.rows.entries()) {
    const explicitId = input.rowMetadata?.[index + 1]?.userId;
    if (explicitId != null) authorIds.set(row[1], explicitId);
  }
  const priorContextMessages = input.rows.map<StoredMessage>(
    ([createdAt, senderDisplayName, text], index) => ({
      chatId: 1,
      messageId: index + 1,
      userId:
        senderDisplayName === 'Бот'
          ? 77
          : (authorIds.get(senderDisplayName) ?? null),
      senderDisplayName,
      text,
      createdAt,
      isBot: senderDisplayName === 'Бот',
      replyToMessageId: null,
      ...input.rowMetadata?.[index + 1]
    })
  );
  const existingAnchor = input.replyAnchorText
    ? [...priorContextMessages]
        .reverse()
        .find(
          (message) =>
            message.text === input.replyAnchorText &&
            (input.replyAnchorIsBot === undefined ||
              message.isBot === input.replyAnchorIsBot)
        )
    : undefined;
  const newAnchor = Boolean(input.replyAnchorText && !existingAnchor);
  const anchorMessageId = existingAnchor?.messageId ?? input.rows.length + 1;
  const triggerMessageId = input.rows.length + (newAnchor ? 2 : 1);
  const lastTime = Date.parse(
    priorContextMessages.at(-1)?.createdAt ?? '2026-10-24T10:00:00Z'
  );
  const triggerTime = new Date(
    lastTime + (newAnchor ? 2000 : 1000)
  ).toISOString();

  const fixture: IntentEvalFixture = {
    id: input.id,
    intent: input.intent,
    targetDisplayName: input.targetDisplayName,
    assistantInstructions:
      input.assistantInstructions ?? DEFAULT_ASSISTANT_INSTRUCTIONS,
    currentDateTime: formatMoscowCurrentDateTime(triggerTime),
    replyContext: {
      triggerMessage: {
        chatId: 1,
        messageId: triggerMessageId,
        userId: authorIds.get(input.targetDisplayName) ?? null,
        senderDisplayName: input.targetDisplayName,
        text: input.triggerText,
        createdAt: triggerTime,
        isBot: false,
        replyToMessageId:
          input.replyToMessageId ??
          (input.replyAnchorText ? anchorMessageId : null)
      },
      replyAnchorMessage:
        input.replyAnchorText && usesReplyAnchor(input.intent)
          ? (existingAnchor ?? {
              chatId: 1,
              messageId: anchorMessageId,
              userId: input.replyAnchorIsBot ? 77 : 555,
              senderDisplayName: input.replyAnchorIsBot ? 'Бот' : 'Anchor User',
              text: input.replyAnchorText,
              createdAt: new Date(lastTime + 1000).toISOString(),
              isBot: input.replyAnchorIsBot ?? false,
              replyToMessageId: null
            })
          : null,
      priorContextMessages
    },
    rubric: input.rubric
  };

  if (input.evaluation) fixture.evaluation = input.evaluation;
  if (input.expectedMode) fixture.expectedMode = input.expectedMode;
  if (input.expectedMessageIds)
    fixture.expectedMessageIds = input.expectedMessageIds;

  if (input.intent === 'answer') {
    const messages = [
      ...priorContextMessages,
      ...(newAnchor ? [fixture.replyContext.replyAnchorMessage] : []),
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
        triggerMessageId,
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
