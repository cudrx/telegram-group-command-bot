import { randomUUID } from 'node:crypto';

import type { NormalizedMessage } from '../../domain/models.js';
import {
  decideReplyAction,
  detectDirectTrigger
} from '../../domain/response-policy.js';
import { runWeeklyJob } from '../weekly/index.js';
import { ChatOrchestratorMediaSupport } from './media/index.js';
import { runMemeJob } from './meme-job.js';
import { runReplyJob } from './reply-job.js';
import type {
  ChatOrchestratorDeps,
  ReplyJobRequest,
  ReplyRequest
} from './types.js';

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

    if (decision.intent === 'meme') {
      await runMemeJob({
        deps: this.deps,
        request,
        logger
      });
      return;
    }

    await runReplyJob({
      deps: this.deps,
      mediaSupport: this.mediaSupport,
      request: {
        ...request,
        intent: decision.intent
      } satisfies ReplyJobRequest,
      logger
    });
  }
}
