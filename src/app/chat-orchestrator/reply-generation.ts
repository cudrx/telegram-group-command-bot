import { answerActionConfig } from '../../config/runtime/index.js';
import { formatMoscowCurrentDateTime } from '../../llm/current-datetime.js';
import type {
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
  getContextLimitForIntent,
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
    return createLocalReplyResult(text.answer.usageFallback);
  }

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

  const assistantInstructions = loadAssistantInstructions();

  if (request.intent === 'answer') {
    return generateAnswer(
      deps,
      {
        assistantInstructions,
        targetDisplayName: request.fromDisplayName,
        currentDateTime: formatMoscowCurrentDateTime(deps.now()),
        replyContext,
        mediaContext: targetMediaContext
      },
      logger
    );
  }

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

async function generateAnswer(
  deps: ChatOrchestratorDeps,
  input: GenerateAnswerInput,
  logger: ChatOrchestratorDeps['logger']
): Promise<LlmReplyResult> {
  try {
    const first = await deps.qwen.generateAnswer(input);

    if (first.decision.mode === 'direct') {
      return toReplyResult(first.decision.text, first);
    }

    if (first.decision.mode !== 'research') {
      throw new Error('Answer preflight returned grounded output');
    }

    if (!deps.lookupProvider) {
      return createLocalReplyResult(text.answer.lookupFailedFallback);
    }

    const lookup = await deps.lookupProvider
      .search({
        query: first.decision.query,
        maxResults: deps.env.lookupMaxResults,
        timeoutMs: Math.min(
          deps.env.lookupTimeoutMs,
          answerActionConfig.lookupTimeoutMs
        )
      })
      .catch((error: unknown) => {
        logger.warn('answer_lookup_failed', serializeError(error));
        return null;
      });

    if (!lookup) {
      return createLocalReplyResult(text.answer.lookupFailedFallback);
    }

    const second = await deps.qwen.generateAnswer({
      ...input,
      research: {
        plan: first.decision,
        result: {
          query: lookup.query,
          sources: lookup.sources.map((source, index) => ({
            id: `web_${index + 1}`,
            ...source
          }))
        }
      }
    });

    if (second.decision.mode !== 'grounded') {
      throw new Error('Grounded answer returned preflight output');
    }

    return toReplyResult(second.decision.text, {
      ...second,
      latencyMs: first.latencyMs + second.latencyMs,
      attemptCount: first.attemptCount + second.attemptCount,
      promptTokensEstimate:
        first.promptTokensEstimate + second.promptTokensEstimate
    });
  } catch (error) {
    logger.warn('answer_generation_failed', serializeError(error));
    return createLocalReplyResult(text.answer.failedFallback);
  }
}

function toReplyResult(
  textValue: string,
  result: GenerateAnswerResult
): LlmReplyResult {
  return {
    text: textValue,
    model: result.model,
    source: 'llm',
    latencyMs: result.latencyMs,
    attemptCount: result.attemptCount,
    promptTokensEstimate: result.promptTokensEstimate
  };
}
