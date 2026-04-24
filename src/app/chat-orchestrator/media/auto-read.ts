import type {
  MediaMessageSnapshot,
  StoredMessage
} from '../../../domain/models.js';
import { type AppLogger, serializeError } from '../../../logging/logger.js';
import {
  AUTO_READ_FAILED_ARTIFACT_KIND,
  AUTO_READ_FAILED_MODEL,
  AUTO_READ_FAILED_PROVIDER,
  AUTO_READ_MAX_ATTEMPTS,
  addDaysIso,
  toShortErrorText
} from '../helpers.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';

export type AutoReadResult =
  | { status: 'success' }
  | { status: 'failed'; error: Error };

export class MediaAutoReadCoordinator {
  private readonly inFlight = new Map<string, Promise<AutoReadResult>>();
  private readonly albumImageKeys = new Set<string>();

  constructor(
    private readonly deps: Pick<ChatOrchestratorDeps, 'db' | 'env' | 'now'>,
    private readonly ensureMediaContext: (input: {
      request: ReplyRequest;
      media: MediaMessageSnapshot;
      logger: AppLogger;
    }) => Promise<unknown>
  ) {}

  startForIncomingMessage(message: StoredMessage, logger: AppLogger): void {
    const media = message.mediaSnapshot;

    if (!media) {
      return;
    }

    if (!this.shouldProcessIncoming(message, media)) {
      return;
    }

    const request = this.createSyntheticRequest(message);

    void this.ensureComplete({
      request,
      media,
      logger,
      startIfMissing: true
    });
  }

  async ensureComplete(input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
    startIfMissing: boolean;
  }): Promise<AutoReadResult | null> {
    const key = buildAutoReadKey(input.media, input.request.chatId);
    const existing = this.inFlight.get(key);

    if (existing) {
      return existing;
    }

    if (!input.startIfMissing) {
      return null;
    }

    const promise = this.runWithRetries(input)
      .catch((error) => {
        const normalized =
          error instanceof Error ? error : new Error(String(error));

        input.logger.error('media_auto_read_failed', {
          mediaKind: input.media.mediaKind,
          ...serializeError(normalized)
        });

        return { status: 'failed' as const, error: normalized };
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);

    return promise;
  }

  private async runWithRetries(input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
  }): Promise<AutoReadResult> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= AUTO_READ_MAX_ATTEMPTS; attempt += 1) {
      try {
        const context = await this.ensureMediaContext(input);

        if (!context) {
          throw new Error('Media recognition returned no context.');
        }

        return { status: 'success' };
      } catch (error) {
        lastError = error;

        if (attempt < AUTO_READ_MAX_ATTEMPTS) {
          input.logger.warn('media_auto_read_attempt_failed', {
            attempt,
            mediaKind: input.media.mediaKind,
            ...serializeError(error)
          });
        }
      }
    }

    const finalError =
      lastError instanceof Error ? lastError : new Error(String(lastError));

    try {
      this.saveFailedArtifact(input, finalError);
    } catch (error) {
      input.logger.error('media_auto_read_failed_artifact_save_failed', {
        mediaKind: input.media.mediaKind,
        ...serializeError(error)
      });
    }

    input.logger.error('media_auto_read_failed', {
      mediaKind: input.media.mediaKind,
      ...serializeError(finalError)
    });

    return { status: 'failed', error: finalError };
  }

  private saveFailedArtifact(
    input: { request: ReplyRequest; media: MediaMessageSnapshot },
    error: Error
  ): void {
    const createdAt = this.deps.now();

    this.deps.db.saveMediaArtifact({
      fileUniqueId: input.media.fileUniqueId,
      chatId: input.request.chatId,
      telegramMessageId: input.media.messageId,
      mediaKind: input.media.mediaKind,
      provider: AUTO_READ_FAILED_PROVIDER,
      providerModel: AUTO_READ_FAILED_MODEL,
      artifactKind: AUTO_READ_FAILED_ARTIFACT_KIND,
      artifactStatus: 'failed',
      artifactText: null,
      artifactJson: null,
      rawResponseJson: null,
      sourceCaption: input.media.caption,
      sourceMimeType: input.media.mimeType,
      sourceFileSize: input.media.fileSize,
      sourceDurationSeconds: input.media.durationSeconds,
      recognitionLanguage: null,
      confidenceJson: null,
      errorText: toShortErrorText(error),
      createdAt,
      expiresAt: addDaysIso(createdAt, this.deps.env.mediaArtifactRetentionDays)
    });
  }

  private createSyntheticRequest(message: StoredMessage): ReplyRequest {
    return {
      chatId: message.chatId,
      chatType: 'unknown',
      chatTitle: null,
      triggerMessageId: message.messageId,
      fromDisplayName: message.senderDisplayName,
      createdAt: message.createdAt,
      intent: 'answer',
      replyToMessageSnapshot: null,
      replyToMediaSnapshot: message.mediaSnapshot ?? null
    };
  }

  private shouldProcessIncoming(
    message: StoredMessage,
    media: MediaMessageSnapshot
  ): boolean {
    if (!message.mediaGroupId) {
      return true;
    }

    if (media.mediaKind !== 'photo' && media.mediaKind !== 'document_image') {
      return false;
    }

    const albumKey = `${message.chatId}:${message.mediaGroupId}`;

    if (this.albumImageKeys.has(albumKey)) {
      return false;
    }

    this.albumImageKeys.add(albumKey);
    return true;
  }
}

export function buildAutoReadKey(
  media: MediaMessageSnapshot,
  chatId: number
): string {
  return media.fileUniqueId
    ? `${media.mediaKind}:file:${media.fileUniqueId}`
    : `${media.mediaKind}:message:${chatId}:${media.messageId}`;
}
