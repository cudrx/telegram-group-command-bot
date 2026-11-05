import { z } from 'zod';
import { answerActionConfig } from '../../config/runtime/index.js';
import type { ReplyContext } from '../../domain/models.js';

const messageId = z.number().int().positive();
const graphSchema = z.object({
  discussions: z
    .array(
      z
        .object({
          id: z.string().trim().min(1).max(64),
          messageIds: z
            .array(messageId)
            .min(1)
            .max(answerActionConfig.context.maxSelectedMessages)
        })
        .strict()
    )
    .max(answerActionConfig.context.maxDiscussions)
    .refine(
      (discussions) =>
        new Set(discussions.map((discussion) => discussion.id)).size ===
        discussions.length,
      { message: 'Duplicate discussion IDs' }
    ),
  inferredLinks: z
    .array(z.object({ from: messageId, to: messageId }).strict())
    .max(answerActionConfig.context.maxInferredLinks),
  selectedDiscussionIds: z
    .array(z.string().trim().min(1).max(64))
    .max(answerActionConfig.context.maxDiscussions)
});

export const researchPlanSchema = z
  .object({
    resolvedQuestion: z.string().trim().min(1),
    purpose: z.enum([
      'entity_grounding',
      'fact_check',
      'freshness',
      'link_extraction'
    ]),
    focusClaim: z.string().trim().min(1),
    queries: z.array(z.string().trim().min(1)).min(1).max(2)
  })
  .strict();

export const answerPlanSchema = z.discriminatedUnion('mode', [
  graphSchema.extend({ mode: z.literal('direct') }).strict(),
  graphSchema
    .extend({ mode: z.literal('clarify'), ambiguity: z.string().trim().min(1) })
    .strict(),
  graphSchema
    .extend({ mode: z.literal('research'), ...researchPlanSchema.shape })
    .strict()
]);

export type AnswerPlan = z.infer<typeof answerPlanSchema>;
export type AnswerResearchPlan = z.infer<typeof researchPlanSchema>;

export function getSelectedMessageIds(plan: AnswerPlan): number[] {
  const selectedDiscussionIds = new Set(plan.selectedDiscussionIds);
  const messageIds = plan.discussions
    .filter((discussion) => selectedDiscussionIds.has(discussion.id))
    .flatMap((discussion) => discussion.messageIds);

  return [...new Set(messageIds)];
}

export function normalizeAnswerPlan(
  plan: AnswerPlan,
  context: ReplyContext
): AnswerPlan {
  const requestId = context.triggerMessage?.messageId;
  const messages = [
    context.replyAnchorMessage,
    ...context.priorContextMessages
  ].filter((message) => message !== null);
  const explicitParents = new Map(
    messages.map((message) => [message.messageId, message.replyToMessageId])
  );
  const discussions = plan.discussions
    .map((discussion) => ({
      ...discussion,
      messageIds: discussion.messageIds.filter((id) => id !== requestId)
    }))
    .filter((discussion) => discussion.messageIds.length > 0);
  const emptyDiscussionIds = new Set(
    plan.discussions
      .filter((discussion) =>
        discussion.messageIds.every((id) => id === requestId)
      )
      .map((discussion) => discussion.id)
  );

  return {
    ...plan,
    discussions,
    selectedDiscussionIds: plan.selectedDiscussionIds.filter(
      (id) => !emptyDiscussionIds.has(id)
    ),
    inferredLinks: plan.inferredLinks.filter(
      (link) =>
        link.from !== requestId &&
        link.to !== requestId &&
        explicitParents.get(link.from) !== link.to
    )
  };
}

export function validateAnswerPlan(
  plan: AnswerPlan,
  context: ReplyContext
): void {
  const allowedMessageIds = new Set(
    context.priorContextMessages.map((message) => message.messageId)
  );
  if (context.replyAnchorMessage) {
    allowedMessageIds.add(context.replyAnchorMessage.messageId);
  }

  const discussions = new Map<string, Set<number>>();
  for (const discussion of plan.discussions) {
    const ids = new Set(discussion.messageIds);
    if (ids.size !== discussion.messageIds.length)
      throw new Error(`Duplicate message in discussion: ${discussion.id}`);

    for (const id of ids) {
      if (!allowedMessageIds.has(id))
        throw new Error(`Unknown conversation message: ${id}`);
    }
    discussions.set(discussion.id, ids);
  }
  if (
    new Set(plan.selectedDiscussionIds).size !==
    plan.selectedDiscussionIds.length
  )
    throw new Error('Duplicate selected discussion');

  for (const id of plan.selectedDiscussionIds) {
    if (!discussions.has(id)) throw new Error(`Unknown discussion: ${id}`);
  }
  if (
    getSelectedMessageIds(plan).length >
    answerActionConfig.context.maxSelectedMessages
  )
    throw new Error('Selected context exceeds message limit');

  const links = new Set<string>();
  for (const link of plan.inferredLinks) {
    const key = `${link.from}:${link.to}`;
    if (links.has(key)) throw new Error(`Duplicate inferred link: ${key}`);

    links.add(key);
    if (link.to >= link.from)
      throw new Error(`Inferred link must point to an earlier message: ${key}`);
    const sharesDiscussion = [...discussions.values()].some(
      (ids) => ids.has(link.from) && ids.has(link.to)
    );
    if (!sharesDiscussion)
      throw new Error(
        `Inferred link must belong to a supplied discussion: ${key}`
      );
  }
}

export function selectedDiscussionGraph(
  plan: AnswerPlan,
  context: ReplyContext
) {
  const visible = new Set([
    context.replyAnchorMessage?.messageId,
    ...context.priorContextMessages.map((message) => message.messageId)
  ]);
  const selected = new Set(plan.selectedDiscussionIds);
  const discussions = plan.discussions
    .filter((discussion) => selected.has(discussion.id))
    .map((discussion) => ({
      ...discussion,
      messageIds: discussion.messageIds.filter((id) => visible.has(id))
    }))
    .filter((discussion) => discussion.messageIds.length > 0);

  return {
    discussions,
    inferredLinks: plan.inferredLinks.filter((link) =>
      discussions.some(
        (discussion) =>
          discussion.messageIds.includes(link.from) &&
          discussion.messageIds.includes(link.to)
      )
    ),
    mode: plan.mode,
    ...(plan.mode === 'clarify' ? { ambiguity: plan.ambiguity } : {})
  };
}
