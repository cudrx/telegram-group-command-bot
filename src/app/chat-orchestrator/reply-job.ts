import { serializeError } from '../../logging/logger.js';
import { runReadTtsJob } from '../actions/read/read-command.js';
import { formatTelegramHtmlReply } from '../telegram-html.js';
import { runWithReplyTyping } from './helpers/reply.js';
import type { ChatOrchestratorMediaSupport } from './media/index.js';
import { dispatchGeneratedReply } from './outbound-voice.js';
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

    const generatedText = normalizeGeneratedReplyText(
      result.text,
      request.intent
    );
    const replyText = formatTelegramHtmlReply(generatedText, {
      intent: request.intent
    });

    const delivery = await dispatchGeneratedReply({
      deps,
      request,
      logger,
      generatedText,
      formattedText: replyText,
      llmResult: {
        ...result,
        text: generatedText
      }
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

function normalizeGeneratedReplyText(
  text: string,
  intent: ReplyJobRequest['intent']
): string {
  if (intent !== 'translate') {
    return text;
  }

  return formatTranslateReplyBlocks(text.replaceAll(/ *\\n */g, '\n'));
}

function formatTranslateReplyBlocks(text: string): string {
  const output: string[] = [];

  for (const line of text.split('\n')) {
    const header = parseTranslateHeader(line);

    if (!header) {
      output.push(line);
      continue;
    }

    if (output.length > 0 && output.at(-1) !== '') {
      output.push('');
    }

    output.push(`<b>${header}:</b>`);
  }

  return output.join('\n');
}

function parseTranslateHeader(line: string): string | null {
  const match =
    /^ *(?:<b>)?(Текст сообщения|Подпись|Текст на картинке|Расшифровка аудио|Описание изображения):(?:<\/b>)? *$/u.exec(
      line
    );

  return match?.[1] ?? null;
}
