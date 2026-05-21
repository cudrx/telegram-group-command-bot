import { randomUUID } from 'node:crypto';

import type { NormalizedMessage } from '../../domain/models.js';
import { chatActionRegistry } from '../actions/index.js';
import { ChatOrchestratorMediaSupport } from './media/index.js';
import { runDirectRedditVideoMemeJob } from './meme-job.js';
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

    const storedMessage = this.deps.db.getMessageByTelegramMessageId(
      message.chatId,
      message.messageId
    );

    if (storedMessage) {
      this.mediaSupport.startAutoReadForIncomingMessage(storedMessage, logger);
    }

    const resolvedAction = chatActionRegistry.resolveCommand({
      botUsername: this.deps.bot.username,
      ...(message.authorizedMode ? { mode: message.authorizedMode } : {}),
      text: message.text,
      entities: message.entities
    });

    logger.debug('incoming_message_evaluated', {
      commandText: resolvedAction?.commandText ?? null,
      decision: resolvedAction ? 'command' : 'ignore',
      intent: resolvedAction?.action.intent
    });

    if (resolvedAction) {
      const request: ReplyRequest = {
        chatId: message.chatId,
        chatType: message.chatType,
        chatTitle: message.chatTitle,
        triggerMessageId: message.messageId,
        fromDisplayName: message.fromDisplayName,
        createdAt: message.createdAt,
        intent: resolvedAction.action.intent,
        replyToMessageSnapshot: message.replyToMessageSnapshot,
        replyToMediaSnapshot: message.replyToMediaSnapshot
      };

      await resolvedAction.action.handle({
        deps: this.deps,
        mediaSupport: this.mediaSupport,
        request,
        logger
      });
      return;
    }

    const directRedditVideoRequest: ReplyRequest = {
      chatId: message.chatId,
      chatType: message.chatType,
      chatTitle: message.chatTitle,
      triggerMessageId: message.messageId,
      fromDisplayName: message.fromDisplayName,
      createdAt: message.createdAt,
      intent: 'meme',
      replyToMessageSnapshot: message.replyToMessageSnapshot,
      replyToMediaSnapshot: message.replyToMediaSnapshot
    };
    const handledRedditVideo = await runDirectRedditVideoMemeJob({
      deps: this.deps,
      mediaSupport: this.mediaSupport,
      request: directRedditVideoRequest,
      text: message.text,
      logger
    });

    if (handledRedditVideo) {
      return;
    }
  }
}
