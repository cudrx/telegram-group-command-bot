import type {
  MediaMessageSnapshot,
  ReplyContext,
  StoredMessage
} from '../../../domain/models.js';
import type { DescribeMediaContext } from '../../../llm/prompts.js';
import type { AppLogger } from '../../../logging/logger.js';
import {
  appendMediaSummaryToMessageText,
  NEARBY_MEDIA_SCAN_LIMIT
} from '../helpers/media.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';
import { ensureAudioMediaContext } from './audio.js';
import { MediaAutoReadCoordinator } from './auto-read.js';
import {
  getCachedMediaContext,
  getPreferredMediaSummary,
  getTargetMediaSnapshot
} from './cache.js';
import { ensureImageMediaContext } from './image.js';

export class ChatOrchestratorMediaSupport {
  private readonly autoRead: MediaAutoReadCoordinator;

  constructor(private readonly deps: ChatOrchestratorDeps) {
    this.autoRead = new MediaAutoReadCoordinator(this.deps, (input) =>
      this.ensureMediaContext(input)
    );
  }

  startAutoReadForIncomingMessage(
    message: StoredMessage,
    logger: AppLogger
  ): void {
    if (
      !message.mediaSnapshot ||
      !this.hasRecognitionProviderFor(message.mediaSnapshot)
    ) {
      return;
    }

    this.autoRead.startForIncomingMessage(message, logger);
  }

  async buildTargetMediaContext(
    request: ReplyRequest,
    replyContext: ReplyContext,
    logger: AppLogger
  ): Promise<DescribeMediaContext | null> {
    if (request.intent !== 'answer') {
      return null;
    }

    const targetMedia = getTargetMediaSnapshot(request, replyContext);

    if (!targetMedia) {
      return null;
    }

    if (!this.hasRecognitionProviderFor(targetMedia)) {
      return getCachedMediaContext(this.deps, { request, media: targetMedia });
    }

    return this.ensureMediaContext({ request, media: targetMedia, logger });
  }

  async enrichReplyContextWithNearbyMedia(
    request: ReplyRequest,
    replyContext: ReplyContext,
    _logger: AppLogger
  ): Promise<ReplyContext> {
    if (
      request.intent !== 'decide' &&
      request.intent !== 'answer' &&
      request.intent !== 'summarize'
    ) {
      return replyContext;
    }

    const nearbyWindow = this.deps.db.getMessagesBefore(
      request.chatId,
      request.triggerMessageId,
      NEARBY_MEDIA_SCAN_LIMIT
    );
    const nearbyMediaMessages = nearbyWindow.filter(
      (message) => message.mediaSnapshot
    );

    const cachedArtifacts = this.deps.db.getSuccessfulMediaArtifactsForMessages(
      {
        chatId: request.chatId,
        messageIds: nearbyMediaMessages.map((message) => message.messageId)
      }
    );
    const messagesById = new Map<number, StoredMessage>();

    for (const message of replyContext.priorContextMessages) {
      messagesById.set(message.messageId, { ...message });
    }

    for (const message of nearbyMediaMessages) {
      const mediaSnapshot = message.mediaSnapshot;

      if (!mediaSnapshot) {
        continue;
      }

      const summary = getPreferredMediaSummary(
        cachedArtifacts,
        message.messageId,
        mediaSnapshot.mediaKind
      );

      if (!summary) {
        continue;
      }

      messagesById.set(message.messageId, {
        ...message,
        text: appendMediaSummaryToMessageText(message.text, summary)
      });
    }

    return {
      ...replyContext,
      priorContextMessages: Array.from(messagesById.values()).sort(
        (left, right) => left.messageId - right.messageId
      )
    };
  }

  async waitForRequiredMedia(
    request: ReplyRequest,
    replyContext: ReplyContext,
    logger: AppLogger
  ): Promise<{ ok: true } | { ok: false }> {
    const media = this.getRequiredMediaForIntent(request, replyContext);

    for (const item of media) {
      if (!this.hasRecognitionProviderFor(item)) {
        continue;
      }

      const result = await this.autoRead.ensureComplete({
        request,
        media: item,
        logger,
        startIfMissing: true
      });

      if (result?.status === 'failed') {
        return { ok: false };
      }
    }

    return { ok: true };
  }

  async waitForOptionalInFlightMedia(
    request: ReplyRequest,
    replyContext: ReplyContext,
    logger: AppLogger
  ): Promise<void> {
    if (request.intent !== 'summarize') {
      return;
    }

    const mediaItems = replyContext.priorContextMessages
      .map((message) => message.mediaSnapshot ?? null)
      .filter((media): media is MediaMessageSnapshot => Boolean(media));

    await Promise.all(
      mediaItems.map((media) =>
        this.autoRead.ensureComplete({
          request,
          media,
          logger,
          startIfMissing: false
        })
      )
    );
  }

  private getRequiredMediaForIntent(
    request: ReplyRequest,
    replyContext: ReplyContext
  ): MediaMessageSnapshot[] {
    if (request.intent === 'answer') {
      const target = getTargetMediaSnapshot(request, replyContext);
      return target ? [target] : [];
    }

    if (request.intent === 'decide') {
      return replyContext.priorContextMessages
        .map((message) => message.mediaSnapshot ?? null)
        .filter((media): media is MediaMessageSnapshot => Boolean(media));
    }

    return [];
  }

  private hasRecognitionProviderFor(media: MediaMessageSnapshot): boolean {
    if (media.mediaKind === 'photo' || media.mediaKind === 'document_image') {
      return Boolean(this.deps.visionProvider || this.deps.ocrProvider);
    }

    if (
      media.mediaKind === 'voice' ||
      media.mediaKind === 'audio' ||
      media.mediaKind === 'video_note'
    ) {
      return Boolean(this.deps.speechToTextProvider);
    }

    return false;
  }

  private ensureMediaContext(input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
  }): Promise<DescribeMediaContext | null> {
    if (
      input.media.mediaKind === 'photo' ||
      input.media.mediaKind === 'document_image'
    ) {
      return ensureImageMediaContext(this.deps, input);
    }

    return ensureAudioMediaContext(this.deps, input);
  }
}
