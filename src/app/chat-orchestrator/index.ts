import { randomUUID } from 'node:crypto';

import type { NormalizedMessage } from '../../domain/models.js';
import {
  chatActionRegistry,
  isFeatureEnabledForAccessContext
} from '../actions/index.js';
import { detectDirectMediaLink } from './direct-media-link.js';
import { ChatOrchestratorMediaSupport } from './media/index.js';
import { runDirectMediaMemeJob } from './meme-job/direct.js';
import type {
  ChatOrchestratorDeps,
  IncomingMessage,
  ReplyRequest
} from './types.js';

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

  async handleIncomingMessage(message: IncomingMessage): Promise<void> {
    const correlationId = randomUUID();
    const logger = this.deps.logger.child({
      correlationId,
      chatId: message.chatId,
      messageId: message.messageId
    });
    const accessContext = requireAccessContext(message);
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
      ...(accessContext.kind === 'private_admin'
        ? { mode: 'private_admin' as const }
        : accessContext.kind === 'private_link_sender'
          ? { mode: 'private_link_sender' as const }
          : {}),
      text: message.text,
      entities: message.entities
    });

    logger.debug('incoming_message_evaluated', {
      commandText: resolvedAction?.commandText ?? null,
      decision: resolvedAction ? 'command' : 'ignore',
      intent: resolvedAction?.action.intent
    });

    if (
      accessContext.kind === 'private_link_sender' &&
      hasLeadingBotCommand(message)
    ) {
      return;
    }

    if (resolvedAction) {
      if (
        !isFeatureEnabledForAccessContext(
          accessContext,
          resolvedAction.requiredFeature
        )
      ) {
        return;
      }

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

    const directMediaLink = detectDirectMediaLink(message.text);
    if (!directMediaLink) {
      return;
    }

    if (!isFeatureEnabledForAccessContext(accessContext, 'direct_links')) {
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
    const handledDirectMedia = await runDirectMediaMemeJob({
      deps: this.deps,
      mediaSupport: this.mediaSupport,
      request: directRedditVideoRequest,
      kind: directMediaLink.kind,
      text: message.text,
      logger
    });

    if (handledDirectMedia) {
      return;
    }
  }
}

function hasLeadingBotCommand(message: NormalizedMessage): boolean {
  return message.entities.some(
    (entity) => entity.type === 'bot_command' && entity.offset === 0
  );
}

function requireAccessContext(
  message: NormalizedMessage
): IncomingMessage['accessContext'] {
  if (!message.accessContext || message.accessContext.kind === 'unauthorized') {
    throw new Error('Missing access context for incoming message');
  }

  return message.accessContext;
}
