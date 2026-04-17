import { randomUUID } from "node:crypto";

import type { AppEnv } from "../config/env.js";
import type { NormalizedMessage, ReplyContext } from "../domain/models.js";
import { decideReplyAction, detectDirectTrigger } from "../domain/response-policy.js";
import { serializeError, type AppLogger } from "../logging/logger.js";
import { DatabaseClient } from "../storage/database.js";
import { buildReplyContext } from "./reply-context-builder.js";
import { withTypingIndicator } from "./typing-indicator.js";

export type BotIdentity = {
  userId: number;
  username: string | null;
  displayName: string;
};

export type SentBotMessage = {
  messageId: number;
  createdAt: string;
};

export type LlmReplyResult = {
  text: string;
  model: string;
  latencyMs: number;
  attemptCount: number;
  promptTokensEstimate: number;
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
    reason: string;
    replyContext: ReplyContext;
  }): Promise<LlmReplyResult>;
};

type ReplyRequest = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  triggerMessageId: number;
  fromDisplayName: string;
  createdAt: string;
  reason: "mention";
};

export class ChatOrchestrator {
  constructor(
    private readonly deps: {
      db: DatabaseClient;
      qwen: LlmClient;
      env: AppEnv;
      bot: BotIdentity;
      replyDispatcher: ReplyDispatcher;
      sendTyping: (chatId: number) => Promise<void>;
      delay: (ms: number) => Promise<void>;
      loadAssistantInstructions: (filePath: string) => Promise<string>;
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
    const decision = decideReplyAction({ directTrigger });

    logger.info("incoming_message_evaluated", {
      directTrigger,
      decision: decision.reason
    });

    if (!decision.shouldReply) {
      return;
    }

    if (decision.reason === "ignore") {
      return;
    }

    const request: ReplyRequest = {
      chatId: message.chatId,
      chatType: message.chatType,
      chatTitle: message.chatTitle,
      triggerMessageId: message.messageId,
      fromDisplayName: message.fromDisplayName,
      createdAt: message.createdAt,
      reason: decision.reason
    };

    await this.runReplyJob(request, logger);
  }

  private async runReplyJob(request: ReplyRequest, logger: AppLogger): Promise<void> {
    try {
      logger.info("reply_job_started", {
        replyReason: request.reason,
        replyToMessageId: request.triggerMessageId
      });

      const result = await this.executeReplyGeneration(request, logger);

      if (!result) {
        logger.info("reply_job_skipped", {
          replyReason: request.reason,
          replyToMessageId: request.triggerMessageId
        });
        return;
      }

      const sent = await this.deps.replyDispatcher({
        chatId: request.chatId,
        replyToMessageId: request.triggerMessageId,
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
        displayName: this.deps.bot.displayName,
        replyToMessageId: request.triggerMessageId
      });

      logger.info("reply_job_completed", {
        replyReason: request.reason,
        replyToMessageId: request.triggerMessageId,
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
    }
  }

  private async executeReplyGeneration(
    request: ReplyRequest,
    logger: AppLogger
  ): Promise<LlmReplyResult | null> {
    const replyContext = buildReplyContext({
      db: this.deps.db,
      chatId: request.chatId,
      triggerMessageId: request.triggerMessageId,
      messageContextLimit: this.deps.env.messageContextLimit
    });

    return this.withReplyTyping(request.chatId, async () => {
      const assistantInstructions = await this.deps.loadAssistantInstructions(
        this.deps.env.assistantInstructionsFile
      );

      return this.deps.qwen.generateReply({
        assistantInstructions,
        targetDisplayName: request.fromDisplayName,
        reason: request.reason,
        replyContext
      });
    });
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
