import { formatMoscowCurrentDateTime } from '../../llm/current-datetime.js';
import { getSelectedMessageIds } from '../../llm/openai-compatible-client/answer.js';
import type {
  AnswerResearchContext,
  AnswerResearchPlan,
  GenerateAnswerInput,
  GenerateAnswerResult,
  LlmReplyResult
} from '../../llm/openai-compatible-client/index.js';
import { loadAssistantInstructions } from '../../llm/prompt-files.js';
import { text } from '../../locales/locale.js';
import { serializeError } from '../../logging/logger.js';
import { buildReplyContext } from '../reply-context-builder.js';
import {
  createLocalReplyResult,
  getContextLimitForIntent
} from './helpers/reply.js';
import type { ChatOrchestratorMediaSupport } from './media/index.js';
import { prepareTranslateReply } from './translate/index.js';
import type { ChatOrchestratorDeps, ReplyJobRequest } from './types.js';

export async function executeReplyGeneration(input: {
  deps: ChatOrchestratorDeps;
  mediaSupport: ChatOrchestratorMediaSupport;
  request: ReplyJobRequest;
  logger: ChatOrchestratorDeps['logger'];
}): Promise<LlmReplyResult | null> {
  const { deps, mediaSupport, request, logger } = input;
  let replyContext = buildReplyContext({
    db: deps.db,
    chatId: request.chatId,
    triggerMessageId: request.triggerMessageId,
    contextLimit: getContextLimitForIntent(deps.env, request.intent),
    intent: request.intent,
    botUserId: deps.bot.userId,
    replyToMessageSnapshot: request.replyToMessageSnapshot
  });

  if (request.intent === 'translate' && !replyContext.replyAnchorMessage) {
    return createLocalReplyResult(text.translate.usageFallback);
  }

  const mediaGate = await mediaSupport.waitForRequiredMedia(
    request,
    replyContext,
    logger
  );

  if (!mediaGate.ok) {
    logger.warn('reply_job_skipped_required_media_failed', {
      intent: request.intent
    });
    return null;
  }

  replyContext = mediaSupport.enrichReplyContextWithNearbyMedia(
    request,
    replyContext
  );
  const targetMediaContext = await mediaSupport.buildTargetMediaContext(
    request,
    replyContext,
    logger
  );

  if (request.intent === 'translate') {
    const translatePreparation = prepareTranslateReply({
      request,
      replyContext,
      mediaContext: targetMediaContext
    });

    if (!translatePreparation.ok) {
      return translatePreparation.result;
    }

    replyContext = translatePreparation.replyContext;
  }

  const assistantInstructions = loadAssistantInstructions();

  if (request.intent === 'answer') {
    return generateAnswer(
      deps,
      {
        assistantInstructions,
        currentDateTime: formatMoscowCurrentDateTime(deps.now()),
        replyContext,
        mediaContext: targetMediaContext
      },
      logger
    );
  }

  return deps.qwen.generateReply({
    assistantInstructions,
    targetDisplayName: request.fromDisplayName,
    intent: request.intent,
    currentDateTime: formatMoscowCurrentDateTime(deps.now()),
    replyContext,
    mediaContext: targetMediaContext
  });
}

async function generateAnswer(
  deps: ChatOrchestratorDeps,
  input: GenerateAnswerInput,
  logger: ChatOrchestratorDeps['logger']
): Promise<LlmReplyResult> {
  try {
    const first = await deps.qwen.generateAnswer(input);

    if (!('discussions' in first.decision)) {
      throw new Error('Answer planner returned final output');
    }

    const plan = first.decision;
    let finalInput: GenerateAnswerInput = { ...input, plan };
    logger.debug('answer_context_planned', {
      mode: plan.mode,
      discussionCount: plan.discussions.length,
      selectedDiscussionIds: plan.selectedDiscussionIds,
      selectedMessageIds: getSelectedMessageIds(plan),
      inferredLinkCount: plan.inferredLinks.length
    });

    if (plan.mode === 'research') {
      const { resolvedQuestion, purpose, focusClaim, queries } = plan;
      const researchPlan = { resolvedQuestion, purpose, focusClaim, queries };
      const research = await lookupAnswerResearch(deps, researchPlan, logger);
      if (!research) {
        return createLocalReplyResult(text.answer.lookupFailedFallback);
      }

      finalInput = { ...finalInput, research };
    }

    const second = await deps.qwen.generateAnswer(finalInput);
    if (!('text' in second.decision))
      throw new Error('Answer generator returned planner output');

    return combineAnswerResults(first, second, second.decision.text);
  } catch (error) {
    logger.warn('answer_generation_failed', serializeError(error));
    return createLocalReplyResult(text.answer.failedFallback);
  }
}

async function lookupAnswerResearch(
  deps: ChatOrchestratorDeps,
  plan: AnswerResearchPlan,
  logger: ChatOrchestratorDeps['logger']
): Promise<AnswerResearchContext | null> {
  const lookupProvider = deps.lookupProvider;
  if (!lookupProvider) return null;

  const lookupResults = await Promise.allSettled(
    plan.queries.map((query) =>
      lookupProvider.search({
        query,
        maxResults: deps.env.lookupMaxResults,
        timeoutMs: deps.env.lookupTimeoutMs
      })
    )
  );
  const primaryLookup = lookupResults[0];
  if (primaryLookup?.status === 'rejected') {
    logger.warn('answer_lookup_failed', serializeError(primaryLookup.reason));

    return null;
  }

  const lookups = lookupResults.flatMap((result) => {
    if (result.status === 'fulfilled') return [result.value];

    logger.warn('answer_lookup_failed', serializeError(result.reason));

    return [];
  });
  const sources = lookups.flatMap((lookup) =>
    lookup.sources.map((source) => ({ query: lookup.query, ...source }))
  );

  return {
    plan,
    result: {
      queries: plan.queries,
      sources: sources.map((source, index) => ({
        id: `web_${index + 1}`,
        ...source
      }))
    }
  };
}

function combineAnswerResults(
  first: GenerateAnswerResult,
  second: GenerateAnswerResult,
  textValue: string
): LlmReplyResult {
  return {
    text: textValue,
    model: second.model,
    source: 'llm',
    latencyMs: first.latencyMs + second.latencyMs,
    attemptCount: first.attemptCount + second.attemptCount,
    promptTokensEstimate:
      first.promptTokensEstimate + second.promptTokensEstimate
  };
}
