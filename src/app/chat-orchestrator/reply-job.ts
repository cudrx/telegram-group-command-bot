import { serializeError } from '../../logging/logger.js';
import { formatTelegramHtmlReply } from '../telegram-html.js';
import { runWithReplyTyping } from './helpers/reply.js';
import type { ChatOrchestratorMediaSupport } from './media/index.js';
import { dispatchGeneratedReply } from './outbound-voice.js';
import { runReadTtsJob } from './read-command.js';
import { executeReplyGeneration } from './reply-generation.js';
import type { ChatOrchestratorDeps, ReplyJobRequest } from './types.js';

export async function runReplyJob(input: {
  deps: ChatOrchestratorDeps;
  mediaSupport: ChatOrchestratorMediaSupport;
  request: ReplyJobRequest;
  logger: ChatOrchestratorDeps['logger'];
}): Promise<void> {
  const { deps, mediaSupport, request, logger } = input;

  try {
    logger.debug('reply_job_started', {
      intent: request.intent,
      replyToMessageId: request.triggerMessageId
    });

    if (request.intent === 'read') {
      const delivery = await runReadTtsJob({
        deps,
        request,
        logger
      });

      logger.debug('reply_job_completed', {
        intent: request.intent,
        replyToMessageId: request.triggerMessageId,
        outputMode: delivery.outputMode
      });
      return;
    }

    const result = await runWithReplyTyping(deps, request.chatId, async () =>
      executeReplyGeneration({
        deps,
        mediaSupport,
        request,
        logger
      })
    );

    if (!result) {
      logger.debug('reply_job_skipped', {
        intent: request.intent,
        replyToMessageId: request.triggerMessageId
      });
      return;
    }

    const replyText = formatTelegramHtmlReply(result.text, {
      intent: request.intent
    });

    const delivery = await dispatchGeneratedReply({
      deps,
      request,
      logger,
      generatedText: result.text,
      formattedText: replyText,
      llmResult: result
    });

    logger.debug('reply_job_completed', {
      intent: request.intent,
      replyToMessageId: request.triggerMessageId,
      llmLatencyMs: result.latencyMs,
      llmAttempts: result.attemptCount,
      llmModel: result.model,
      promptTokensEstimate: result.promptTokensEstimate,
      outputMode: delivery.outputMode
    });
  } catch (error) {
    logger.error('reply_job_failed', {
      intent: request.intent,
      ...serializeError(error)
    });
  }
}
