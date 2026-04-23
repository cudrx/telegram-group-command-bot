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
import {
  ANSWER_USAGE_PLACEHOLDER,
  createLocalReplyResult,
  getContextLimitForIntent,
  runWithReplyTyping,
  withReplySnapshotFallback
} from './helpers.js';
import { buildLookupContext } from './lookup.js';
import { ChatOrchestratorMediaSupport } from './media/index.js';
import type { ChatOrchestratorDeps, ReplyRequest } from './types.js';

export type {
  BotIdentity,
  LlmClient,
  ReplyDispatcher,
  SentBotMessage
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

    const directTrigger = detectDirectTrigger({
      botUserId: this.deps.bot.userId,
      botUsername: this.deps.bot.username,
      message: {
        chatType: message.chatType,
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

      const sent = await this.deps.replyDispatcher({
        chatId: request.chatId,
        replyToMessageId: request.triggerMessageId,
        text: replyText
      });

      this.deps.db.saveBotMessage({
        chatId: request.chatId,
        chatType: request.chatType,
        chatTitle: request.chatTitle,
        messageId: sent.messageId,
        text: replyText,
        createdAt: sent.createdAt,
        userId: this.deps.bot.userId,
        username: this.deps.bot.username,
        displayName: this.deps.bot.displayName,
        replyToMessageId: request.triggerMessageId
      });

      logger.debug('reply_job_completed', {
        intent: request.intent,
        replyToMessageId: request.triggerMessageId,
        llmLatencyMs: result.latencyMs,
        llmAttempts: result.attemptCount,
        llmModel: result.model,
        promptTokensEstimate: result.promptTokensEstimate
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
    if (request.intent === 'read') {
      return this.mediaSupport.executeReadGeneration(request, logger);
    }

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
