import { formatMoscowCurrentDateTime } from '../../llm/current-datetime.js';
import type { LlmReplyResult } from '../../llm/openai-compatible-client/index.js';
import { loadPrompt } from '../../llm/prompt-files.js';
import { buildReplyContext } from '../reply-context-builder.js';
import {
  ANSWER_USAGE_PLACEHOLDER,
  createLocalReplyResult,
  getContextLimitForIntent,
  TRANSLATE_USAGE_PLACEHOLDER,
  withReplySnapshotFallback
} from './helpers/reply.js';
import { buildLookupContext } from './lookup.js';
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
  let replyContext = withReplySnapshotFallback(
    buildReplyContext({
      db: deps.db,
      chatId: request.chatId,
      triggerMessageId: request.triggerMessageId,
      contextLimit: getContextLimitForIntent(deps.env, request.intent),
      intent: request.intent,
      botUserId: deps.bot.userId
    }),
    {
      intent: request.intent,
      botUserId: deps.bot.userId,
      replyToMessageSnapshot: request.replyToMessageSnapshot
    }
  );

  if (request.intent === 'answer' && !replyContext.replyAnchorMessage) {
    return createLocalReplyResult(ANSWER_USAGE_PLACEHOLDER);
  }

  if (request.intent === 'translate' && !replyContext.replyAnchorMessage) {
    return createLocalReplyResult(TRANSLATE_USAGE_PLACEHOLDER);
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

  await mediaSupport.waitForOptionalInFlightMedia(
    request,
    replyContext,
    logger
  );

  replyContext = await mediaSupport.enrichReplyContextWithNearbyMedia(
    request,
    replyContext,
    logger
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

  const assistantInstructions = loadPrompt('base');
  const lookupContext = await buildLookupContext(deps, {
    intent: request.intent,
    replyContext,
    logger
  });

  return deps.qwen.generateReply({
    assistantInstructions,
    targetDisplayName: request.fromDisplayName,
    intent: request.intent,
    currentDateTime: formatMoscowCurrentDateTime(deps.now()),
    replyContext,
    lookupContext,
    mediaContext: targetMediaContext
  });
}
