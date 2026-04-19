import { randomUUID } from 'node:crypto';

import type { AppEnv } from '../config/env.js';
import type {
  AssistantIntent,
  NormalizedMessage,
  ReplyContext,
  StoredMessage
} from '../domain/models.js';
import {
  decideReplyAction,
  detectDirectTrigger
} from '../domain/response-policy.js';
import type {
  LlmReplyResult,
  LookupPlanResult
} from '../llm/openai-compatible-llm-client.js';
import { loadPrompt } from '../llm/prompt-files.js';
import { type AppLogger, serializeError } from '../logging/logger.js';
import type {
  LookupContext,
  LookupDecision,
  LookupProvider
} from '../lookup/types.js';
import type { DatabaseClient } from '../storage/database.js';
import { buildReplyContext } from './reply-context-builder.js';
import { formatTelegramHtmlReply } from './telegram-html.js';
import { withTypingIndicator } from './typing-indicator.js';

export type BotIdentity = {
  userId: number;
  username: string | null;
  displayName: string;
};

export type SentBotMessage = {
  messageId: number;
  createdAt: string;
};

export type ReplyDispatcher = (input: {
  chatId: number;
  replyToMessageId: number;
  text: string;
}) => Promise<SentBotMessage>;

export type LlmClient = {
  generateReply(input: {
    assistantInstructions: string;
    targetDisplayName: string;
    intent: AssistantIntent;
    replyContext: ReplyContext;
    lookupContext?: LookupContext | null;
  }): Promise<LlmReplyResult>;
  planLookup(input: {
    intent: Exclude<AssistantIntent, 'summarize'>;
    replyContext: ReplyContext;
  }): Promise<LookupPlanResult>;
};

type ReplyRequest = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  triggerMessageId: number;
  fromDisplayName: string;
  createdAt: string;
  intent: AssistantIntent;
  replyToMessageSnapshot: StoredMessage | null;
};

const EXPLAIN_USAGE_PLACEHOLDER =
  'Сделай reply на сообщение с вопросом и отправь /explain.';

export class ChatOrchestrator {
  constructor(
    private readonly deps: {
      db: DatabaseClient;
      qwen: LlmClient;
      env: AppEnv;
      lookupProvider: LookupProvider | null;
      bot: BotIdentity;
      replyDispatcher: ReplyDispatcher;
      sendTyping: (chatId: number) => Promise<void>;
      delay: (ms: number) => Promise<void>;
      logger: AppLogger;
      now: () => string;
      random: () => number;
    }
  ) {}

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

    if (!decision.shouldReply) {
      return;
    }

    if (!decision.intent) {
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
      replyToMessageSnapshot: message.replyToMessageSnapshot
    };

    await this.runReplyJob(request, logger);
  }

  private async runReplyJob(
    request: ReplyRequest,
    logger: AppLogger
  ): Promise<void> {
    try {
      logger.debug('reply_job_started', {
        intent: request.intent,
        replyToMessageId: request.triggerMessageId
      });

      const result = await this.executeReplyGeneration(request, logger);

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
    logger: AppLogger
  ): Promise<LlmReplyResult | null> {
    const replyContext = withExplainReplySnapshotFallback(
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

    if (request.intent === 'explain' && !replyContext.replyAnchorMessage) {
      logger.warn('explain_anchor_missing', {
        replyToMessageId: replyContext.triggerMessage?.replyToMessageId ?? null,
        replyToUserId: request.replyToMessageSnapshot?.userId ?? null
      });

      return createLocalReplyResult(EXPLAIN_USAGE_PLACEHOLDER);
    }

    return this.withReplyTyping(request.chatId, async () => {
      const assistantInstructions = loadPrompt('base');
      const lookupContext = await this.buildLookupContext({
        intent: request.intent,
        replyContext,
        logger
      });

      return this.deps.qwen.generateReply({
        assistantInstructions,
        targetDisplayName: request.fromDisplayName,
        intent: request.intent,
        replyContext,
        lookupContext
      });
    });
  }

  private async buildLookupContext(input: {
    intent: AssistantIntent;
    replyContext: ReplyContext;
    logger: AppLogger;
  }): Promise<LookupContext | null> {
    if (input.intent === 'summarize') {
      return null;
    }

    if (!this.deps.env.lookupEnabled || !this.deps.lookupProvider) {
      return null;
    }

    let plan: LookupPlanResult;

    try {
      plan = await this.deps.qwen.planLookup({
        intent: input.intent,
        replyContext: input.replyContext
      });
    } catch (error) {
      input.logger.warn('lookup_planner_failed', {
        intent: input.intent,
        ...serializeError(error)
      });

      return createLookupContext({
        status: 'failed',
        intent: input.intent,
        decision: createFailedLookupDecision('Lookup planner failed.'),
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }

    const decision = plan.decision;

    if (plan.status === 'failed') {
      return createLookupContext({
        status: 'failed',
        intent: input.intent,
        decision,
        errorMessage: decision.reason
      });
    }

    input.logger.debug('lookup_planner_completed', {
      intent: input.intent,
      shouldLookup: decision.shouldLookup,
      purpose: decision.purpose,
      confidence: decision.confidence,
      queryCount: decision.queries.length,
      plannerModel: plan.model,
      plannerLatencyMs: plan.latencyMs
    });

    if (!decision.shouldLookup) {
      return createLookupContext({
        status: 'skipped',
        intent: input.intent,
        decision
      });
    }

    const query = decision.queries[0] ?? null;

    if (!query) {
      return createLookupContext({
        status: 'skipped',
        intent: input.intent,
        decision
      });
    }

    try {
      const result = await this.deps.lookupProvider.search({
        query,
        maxResults: this.deps.env.lookupMaxResults,
        timeoutMs: this.deps.env.lookupTimeoutMs
      });

      return createLookupContext({
        status: result.sources.length > 0 ? 'used' : 'weak',
        provider: result.provider,
        intent: input.intent,
        decision,
        query: result.query,
        sources: result.sources,
        responseTimeMs: result.responseTimeMs,
        usageCredits: result.usageCredits
      });
    } catch (error) {
      input.logger.warn('lookup_provider_failed', {
        intent: input.intent,
        query,
        ...serializeError(error)
      });

      return createLookupContext({
        status: isTimeoutError(error) ? 'timed_out' : 'failed',
        intent: input.intent,
        decision,
        query,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async withReplyTyping<T>(
    chatId: number,
    operation: () => Promise<T>
  ): Promise<T> {
    return withTypingIndicator(
      {
        chatId,
        minTypingMs: this.deps.env.replyMinTypingMs,
        maxTypingMs: this.deps.env.replyMaxTypingMs,
        refreshMs: this.deps.env.replyTypingRefreshMs,
        random: this.deps.random,
        delay: this.deps.delay,
        sendTyping: this.deps.sendTyping
      },
      operation
    );
  }
}

function withExplainReplySnapshotFallback(
  context: ReplyContext,
  input: {
    intent: AssistantIntent;
    botUserId: number;
    replyToMessageSnapshot: StoredMessage | null;
  }
): ReplyContext {
  if (
    input.intent !== 'explain' ||
    context.replyAnchorMessage ||
    !input.replyToMessageSnapshot ||
    input.replyToMessageSnapshot.userId === input.botUserId
  ) {
    return context;
  }

  return {
    ...context,
    replyAnchorMessage: input.replyToMessageSnapshot
  };
}

function getContextLimitForIntent(
  env: AppEnv,
  intent: AssistantIntent
): number {
  switch (intent) {
    case 'explain':
      return env.explainContextLimit;
    case 'summarize':
      return env.summarizeContextLimit;
    case 'decide':
      return env.decideContextLimit;
  }
}

function createLocalReplyResult(text: string): LlmReplyResult {
  return {
    text,
    model: 'local',
    latencyMs: 0,
    attemptCount: 0,
    promptTokensEstimate: 0
  };
}

function createLookupContext(input: {
  status: LookupContext['status'];
  provider?: LookupContext['provider'];
  intent: Exclude<AssistantIntent, 'summarize'>;
  decision: LookupDecision;
  query?: string | null;
  sources?: LookupContext['sources'];
  responseTimeMs?: number | null;
  usageCredits?: number | null;
  errorMessage?: string | null;
}): LookupContext {
  return {
    status: input.status,
    provider: input.provider ?? null,
    intent: input.intent,
    decision: input.decision,
    query: input.query ?? null,
    sources: input.sources ?? [],
    responseTimeMs: input.responseTimeMs ?? null,
    usageCredits: input.usageCredits ?? null,
    errorMessage: input.errorMessage ?? null
  };
}

function createFailedLookupDecision(reason: string): LookupDecision {
  return {
    shouldLookup: false,
    purpose: 'none',
    reason,
    queries: [],
    confidence: 'low'
  };
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
