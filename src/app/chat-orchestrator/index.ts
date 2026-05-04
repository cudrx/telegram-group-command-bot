import { randomUUID } from 'node:crypto';

import type { NormalizedMessage } from '../../domain/models.js';
import {
  decideReplyAction,
  detectDirectTrigger
} from '../../domain/response-policy.js';
import type { LlmReplyResult } from '../../llm/openai-compatible-client/index.js';
import { loadPrompt } from '../../llm/prompt-files.js';
import { serializeError } from '../../logging/logger.js';
import { buildReplyContext } from '../reply-context-builder.js';
import { formatTelegramHtmlReply } from '../telegram-html.js';
import { runWeeklyJob } from '../weekly/index.js';
import {
  ANSWER_USAGE_PLACEHOLDER,
  createLocalReplyResult,
  getContextLimitForIntent,
  runWithReplyTyping,
  withReplySnapshotFallback
} from './helpers/reply.js';
import { buildLookupContext } from './lookup.js';
import { ChatOrchestratorMediaSupport } from './media/index.js';
import { dispatchGeneratedReply } from './outbound-voice.js';
import { runReadTtsJob } from './read-command.js';
import type { ChatOrchestratorDeps, ReplyRequest } from './types.js';

export type {
  BotIdentity,
  LlmClient,
  ReplyDispatcher,
  SentBotMessage,
  WeeklyDispatcher
} from './types.js';

export class ChatOrchestrator {
  private readonly mediaSupport: ChatOrchestratorMediaSupport;

  constructor(private readonly deps: ChatOrchestratorDeps) {
    this.mediaSupport = new ChatOrchestratorMediaSupport(deps);
  }

  async handleIncomingMessage(message: NormalizedMessage): Promise<void> {
    const correlationId = randomUUID();
    const logger = this.deps.logger.child({
      correlationId,
      chatId: message.chatId,
      messageId: message.messageId
    });
    const stored = this.deps.db.saveIncomingMessage(message);

    if (!stored) {
      logger.debug('incoming_message_ignored_duplicate');
      return;
    }

    const chatState = this.deps.db.getChatState(message.chatId);

    if (!chatState) {
      logger.warn('chat_state_missing_after_save');
      return;
    }

    const storedMessage = this.deps.db.getMessageByTelegramMessageId(
      message.chatId,
      message.messageId
    );

    if (storedMessage) {
      this.mediaSupport.startAutoReadForIncomingMessage(storedMessage, logger);
    }

    const directTrigger = detectDirectTrigger({
      botUserId: this.deps.bot.userId,
      botUsername: this.deps.bot.username,
      message: {
        ...(message.authorizedMode
          ? { authorizedMode: message.authorizedMode }
          : {}),
        text: message.text,
        entities: message.entities,
        replyToUserId: message.replyToUserId
      }
    });
    const decision = decideReplyAction({ directTrigger });

    logger.debug('incoming_message_evaluated', {
      directTrigger,
      decision: decision.reason,
      intent: decision.intent
    });

    if (directTrigger.kind === 'command' && directTrigger.intent === 'weekly') {
      await runWeeklyJob({
        db: this.deps.db,
        qwen: this.deps.qwen,
        env: this.deps.env,
        bot: this.deps.bot,
        weeklyDispatcher: this.deps.weeklyDispatcher,
        logger,
        now: this.deps.now
      });
      return;
    }

    if (!decision.shouldReply || !decision.intent) {
      return;
    }

    const request: ReplyRequest = {
      chatId: message.chatId,
      chatType: message.chatType,
      chatTitle: message.chatTitle,
      triggerMessageId: message.messageId,
      fromDisplayName: message.fromDisplayName,
      createdAt: message.createdAt,
      intent: decision.intent,
      replyToMessageSnapshot: message.replyToMessageSnapshot,
      replyToMediaSnapshot: message.replyToMediaSnapshot
    };

    await this.runReplyJob(request, logger);
  }

  private async runReplyJob(
    request: ReplyRequest,
    logger: ChatOrchestratorDeps['logger']
  ): Promise<void> {
    try {
      logger.debug('reply_job_started', {
        intent: request.intent,
        replyToMessageId: request.triggerMessageId
      });

      if (request.intent === 'read') {
        const delivery = await runReadTtsJob({
          deps: this.deps,
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

      const result = await runWithReplyTyping(
        this.deps,
        request.chatId,
        async () => this.executeReplyGeneration(request, logger)
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
        deps: this.deps,
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

  private async executeReplyGeneration(
    request: ReplyRequest,
    logger: ChatOrchestratorDeps['logger']
  ): Promise<LlmReplyResult | null> {
    let replyContext = withReplySnapshotFallback(
      buildReplyContext({
        db: this.deps.db,
        chatId: request.chatId,
        triggerMessageId: request.triggerMessageId,
        contextLimit: getContextLimitForIntent(this.deps.env, request.intent),
        intent: request.intent,
        botUserId: this.deps.bot.userId
      }),
      {
        intent: request.intent,
        botUserId: this.deps.bot.userId,
        replyToMessageSnapshot: request.replyToMessageSnapshot
      }
    );

    if (request.intent === 'answer' && !replyContext.replyAnchorMessage) {
      logger.warn(`${request.intent}_anchor_missing`, {
        replyToMessageId: replyContext.triggerMessage?.replyToMessageId ?? null,
        replyToUserId: request.replyToMessageSnapshot?.userId ?? null
      });

      return createLocalReplyResult(ANSWER_USAGE_PLACEHOLDER);
    }

    const mediaGate = await this.mediaSupport.waitForRequiredMedia(
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

    await this.mediaSupport.waitForOptionalInFlightMedia(
      request,
      replyContext,
      logger
    );

    replyContext = await this.mediaSupport.enrichReplyContextWithNearbyMedia(
      request,
      replyContext,
      logger
    );
    const targetMediaContext = await this.mediaSupport.buildTargetMediaContext(
      request,
      replyContext,
      logger
    );

    const assistantInstructions = loadPrompt('base');
    const lookupContext = await buildLookupContext(this.deps, {
      intent: request.intent,
      replyContext,
      logger
    });

    return this.deps.qwen.generateReply({
      assistantInstructions,
      targetDisplayName: request.fromDisplayName,
      intent: request.intent,
      replyContext,
      lookupContext,
      mediaContext: targetMediaContext
    });
  }
}
