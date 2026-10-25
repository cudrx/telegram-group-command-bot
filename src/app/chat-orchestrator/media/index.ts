import type {
  MediaMessageSnapshot,
  ReplyContext,
  StoredMessage
} from '../../../domain/models.js';
import type { DescribeMediaContext } from '../../../llm/prompts.js';
import type { AppLogger } from '../../../logging/logger.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';
import { ensureAudioMediaContext } from './audio.js';
import { MediaAutoReadCoordinator } from './auto-read.js';
import {
  enrichContextWithMediaEvidence,
  getCachedMediaContext,
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
    if (request.intent !== 'answer' && request.intent !== 'translate') {
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

  enrichReplyContextWithNearbyMedia(
    request: ReplyRequest,
    context: ReplyContext
  ): ReplyContext {
    if (request.intent !== 'answer') return context;

    const messageIds = context.priorContextMessages
      .filter((message) => message.mediaSnapshot)
      .map((message) => message.messageId);
    const artifacts = this.deps.db.getSuccessfulMediaArtifactsForMessages({
      chatId: request.chatId,
      messageIds
    });
    return enrichContextWithMediaEvidence(context, artifacts);
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

  private getRequiredMediaForIntent(
    request: ReplyRequest,
    replyContext: ReplyContext
  ): MediaMessageSnapshot[] {
    if (request.intent === 'answer' || request.intent === 'translate') {
      const target = getTargetMediaSnapshot(request, replyContext);
      return target ? [target] : [];
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
