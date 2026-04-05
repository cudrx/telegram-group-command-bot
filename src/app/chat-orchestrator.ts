import { randomUUID } from "node:crypto";

import type { AppEnv } from "../config/env.js";
import { shouldRunIdleSummary } from "../domain/idle-summary-policy.js";
import type { ChatState, NormalizedMessage } from "../domain/models.js";
import { decideReplyAction, detectDirectTrigger } from "../domain/response-policy.js";
import type {
  LlmReplyResult,
  LlmSummaryResult,
  QwenClient
} from "../llm/qwen-client.js";
import { serializeError, type AppLogger } from "../logging/logger.js";
import { DatabaseClient } from "../storage/database.js";
import {
  ChatJobCoordinator,
  type PendingReplyRequest,
  type ReplyReason
} from "./chat-job-coordinator.js";

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

export class ChatOrchestrator {
  private readonly jobs: ChatJobCoordinator;

  constructor(
    private readonly deps: {
      db: DatabaseClient;
      qwen: QwenClient;
      env: AppEnv;
      bot: BotIdentity;
      replyDispatcher: ReplyDispatcher;
      loadPersona: (filePath: string, chatId?: number) => Promise<string>;
      logger: AppLogger;
      random: () => number;
      now: () => string;
      jobs?: ChatJobCoordinator;
    }
  ) {
    this.jobs = deps.jobs ?? new ChatJobCoordinator();
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
      logger.info("incoming_message_ignored_duplicate");
      return;
    }

    const chatState = this.deps.db.getChatState(message.chatId);

    if (!chatState) {
      logger.warn("chat_state_missing_after_save");
      return;
    }

    const directTrigger = detectDirectTrigger({
      botUserId: this.deps.bot.userId,
      botUsername: this.deps.bot.username,
      message: {
        text: message.text,
        entities: message.entities,
        replyToUserId: message.replyToUserId
      }
    });
    const decision = decideReplyAction({
      directTrigger,
      allowDirectMessages: message.chatType === "private",
      allowInterjections: message.chatType !== "private",
      interjectProbability: this.deps.env.interjectProbability,
      randomValue: this.deps.random(),
      cooldownMs: this.deps.env.interjectCooldownMinutes * 60_000,
      lastBotMessageAt: chatState.lastBotMessageAt,
      now: message.createdAt
    });

    logger.info("incoming_message_evaluated", {
      directTrigger,
      decision: decision.reason,
      currentPhase: this.jobs.getPhase(message.chatId)
    });

    if (!decision.shouldReply) {
      return;
    }

    const request = toPendingReplyRequest(message, toReplyReason(decision.reason));

    if (!this.jobs.start(message.chatId, "replying")) {
      this.jobs.queueReply(request);
      logger.info("reply_deferred", {
        queuedReason: request.reason,
        currentPhase: this.jobs.getPhase(message.chatId)
      });
      return;
    }

    await this.runReplyJob(request, logger);
  }

  async runIdleSummarySweep(): Promise<void> {
    this.deps.db.runMaintenance({
      now: this.deps.now(),
      messageRetentionDays: this.deps.env.messageRetentionDays,
      minMessagesToKeep: this.deps.env.messageContextLimit
    });

    const candidates = this.deps.db.listSummaryCandidates();

    for (const candidate of candidates) {
      if (!this.isSummaryDue(candidate, this.deps.now())) {
        continue;
      }

      const correlationId = randomUUID();
      const logger = this.deps.logger.child({
        correlationId,
        chatId: candidate.chatId
      });

      if (!this.jobs.start(candidate.chatId, "summarizing")) {
        this.jobs.queueSummary(candidate.chatId);
        logger.info("summary_deferred", {
          currentPhase: this.jobs.getPhase(candidate.chatId)
        });
        continue;
      }

      await this.runSummaryJob(candidate.chatId, logger);
    }
  }

  private async runReplyJob(
    request: PendingReplyRequest,
    logger: AppLogger
  ): Promise<void> {
    try {
      logger.info("reply_job_started", {
        replyReason: request.reason,
        replyToMessageId: request.replyToMessageId
      });

      const result = await this.executeReplyGeneration(request);
      const sent = await this.deps.replyDispatcher({
        chatId: request.chatId,
        replyToMessageId: request.replyToMessageId,
        text: result.text
      });

      this.deps.db.saveBotMessage({
        chatId: request.chatId,
        chatType: request.chatType,
        chatTitle: request.chatTitle,
        messageId: sent.messageId,
        text: result.text,
        createdAt: sent.createdAt,
        userId: this.deps.bot.userId,
        username: this.deps.bot.username,
        displayName: this.deps.bot.displayName
      });

      logger.info("reply_job_completed", {
        replyReason: request.reason,
        replyToMessageId: request.replyToMessageId,
        llmLatencyMs: result.latencyMs,
        llmAttempts: result.attemptCount,
        llmModel: result.model,
        promptTokensEstimate: result.promptTokensEstimate
      });
    } catch (error) {
      logger.error("reply_job_failed", {
        replyReason: request.reason,
        ...serializeError(error)
      });
    } finally {
      this.jobs.finish(request.chatId, "replying");
      await this.drainPendingWork(request.chatId);
    }
  }

  private async runSummaryJob(chatId: number, logger: AppLogger): Promise<void> {
    try {
      logger.info("summary_job_started");

      const result = await this.executeSummaryGeneration(chatId);

      if (!result) {
        logger.info("summary_job_skipped");
        return;
      }

      this.deps.db.applySummary(
        chatId,
        result.summary.result,
        result.lastMessageId,
        result.updatedAt,
        {
          userId: this.deps.bot.userId,
          username: this.deps.bot.username,
          displayName: this.deps.bot.displayName
        }
      );

      logger.info("summary_job_completed", {
        summarizedMessageCount: result.messageCount,
        llmLatencyMs: result.summary.latencyMs,
        llmAttempts: result.summary.attemptCount,
        llmModel: result.summary.model,
        promptTokensEstimate: result.summary.promptTokensEstimate,
        summaryCursorMessageId: result.lastMessageId
      });
    } catch (error) {
      logger.error("summary_job_failed", serializeError(error));
    } finally {
      this.jobs.finish(chatId, "summarizing");
      await this.drainPendingWork(chatId);
    }
  }

  private async executeReplyGeneration(
    request: PendingReplyRequest
  ): Promise<LlmReplyResult> {
    const chatState = this.deps.db.getChatState(request.chatId);
    const now = this.deps.now();

    if (!chatState) {
      throw new Error(`Chat state is missing for reply in chat ${request.chatId}`);
    }

    this.deps.db.runChatMaintenance({
      chatId: request.chatId,
      now,
      messageRetentionDays: this.deps.env.messageRetentionDays,
      minMessagesToKeep: this.deps.env.messageContextLimit
    });

    const persona = await this.deps.loadPersona(
      this.deps.env.personaFile,
      request.chatId
    );
    const recentMessages = this.deps.db.getRecentMessages(
      request.chatId,
      this.deps.env.messageContextLimit
    );
    const selfMemoryContext = this.deps.db.getParticipantMemoryContext(
      request.chatId,
      this.deps.bot.userId
    );
    const participantMemoryContext =
      request.fromUserId === null
        ? null
        : this.deps.db.getParticipantMemoryContext(
            request.chatId,
            request.fromUserId
          );

    return this.deps.qwen.generateReply({
      persona,
      chatSummary: chatState.summaryText,
      selfMemoryContext,
      participantMemoryContext,
      targetDisplayName: request.fromDisplayName,
      reason: request.reason,
      recentMessages
    });
  }

  private async executeSummaryGeneration(chatId: number): Promise<{
    summary: LlmSummaryResult;
    lastMessageId: number;
    messageCount: number;
    updatedAt: string;
  } | null> {
    const chatState = this.deps.db.getChatState(chatId);
    const updatedAt = this.deps.now();

    if (!chatState || !this.isSummaryDue(chatState, updatedAt)) {
      return null;
    }

    const pendingMessages = this.deps.db.getMessagesSince(
      chatId,
      chatState.summaryCursorMessageId
    );

    if (pendingMessages.length < this.deps.env.minMessagesForSummary) {
      return null;
    }

    const lastMessageId = pendingMessages[pendingMessages.length - 1]?.messageId;

    if (lastMessageId === undefined) {
      return null;
    }

    return {
      summary: await this.deps.qwen.summarizeConversation({
        chatTitle: chatState.title,
        currentSummary: chatState.summaryText,
        messages: pendingMessages
      }),
      lastMessageId,
      messageCount: pendingMessages.length,
      updatedAt
    };
  }

  private async drainPendingWork(chatId: number): Promise<void> {
    const next = this.jobs.takeNext(chatId);

    if (!next) {
      return;
    }

    if (next.type === "reply") {
      if (!this.jobs.start(chatId, "replying")) {
        return;
      }

      await this.runReplyJob(
        next.request,
        this.deps.logger.child({
          correlationId: randomUUID(),
          chatId,
          messageId: next.request.replyToMessageId,
          drainedFromPending: true
        })
      );

      return;
    }

    if (!this.jobs.start(chatId, "summarizing")) {
      return;
    }

    await this.runSummaryJob(
      chatId,
      this.deps.logger.child({
        correlationId: randomUUID(),
        chatId,
        drainedFromPending: true
      })
    );
  }

  private isSummaryDue(chat: ChatState, now: string): boolean {
    return shouldRunIdleSummary({
      lastMessageAt: chat.lastMessageAt,
      lastSummaryAt: chat.summaryUpdatedAt,
      unsummarizedMessageCount: chat.unsummarizedMessageCount,
      idleThresholdMs: this.deps.env.chatIdleMinutes * 60_000,
      minMessages: this.deps.env.minMessagesForSummary,
      now
    });
  }
}

function toPendingReplyRequest(
  message: NormalizedMessage,
  reason: ReplyReason
): PendingReplyRequest {
  return {
    chatId: message.chatId,
    chatType: message.chatType,
    chatTitle: message.chatTitle,
    replyToMessageId: message.messageId,
    fromUserId: message.fromUserId,
    fromDisplayName: message.fromDisplayName,
    createdAt: message.createdAt,
    reason
  };
}

function toReplyReason(
  reason: "mention" | "reply_to_bot" | "direct_message" | "interjection" | "ignore"
): ReplyReason {
  if (reason === "ignore") {
    throw new Error("Cannot convert ignore decision into a reply request");
  }

  return reason;
}
