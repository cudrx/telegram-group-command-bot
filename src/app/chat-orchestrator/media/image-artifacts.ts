import type { MediaMessageSnapshot } from '../../../domain/models.js';
import { addDaysIso } from '../helpers.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';

export function saveImageTextArtifact(
  deps: Pick<ChatOrchestratorDeps, 'db' | 'env' | 'now'>,
  input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    provider: string;
    providerModel: string;
    artifactKind: string;
    artifactText: string;
    rawResponseJson: unknown;
    recognitionLanguage: string | null;
    sourceFileSize: number | null;
  }
): void {
  const createdAt = deps.now();

  deps.db.saveMediaArtifact({
    fileUniqueId: input.media.fileUniqueId,
    chatId: input.request.chatId,
    telegramMessageId: input.media.messageId,
    mediaKind: input.media.mediaKind,
    provider: input.provider,
    providerModel: input.providerModel,
    artifactKind: input.artifactKind,
    artifactStatus: 'success',
    artifactText: input.artifactText,
    artifactJson: { text: input.artifactText },
    rawResponseJson: input.rawResponseJson,
    sourceCaption: input.media.caption,
    sourceMimeType: input.media.mimeType,
    sourceFileSize: input.sourceFileSize,
    sourceDurationSeconds: null,
    recognitionLanguage: input.recognitionLanguage,
    confidenceJson: null,
    errorText: null,
    createdAt,
    expiresAt: addDaysIso(createdAt, deps.env.mediaArtifactRetentionDays)
  });
}

export function saveImageArtifactMarker(
  deps: Pick<ChatOrchestratorDeps, 'db' | 'env' | 'now'>,
  input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    provider: string;
    providerModel: string;
    artifactKind: string;
    rawResponseJson: unknown;
    recognitionLanguage: string | null;
    sourceFileSize: number | null;
    errorText: string;
    artifactJson: unknown;
  }
): void {
  const createdAt = deps.now();

  deps.db.saveMediaArtifact({
    fileUniqueId: input.media.fileUniqueId,
    chatId: input.request.chatId,
    telegramMessageId: input.media.messageId,
    mediaKind: input.media.mediaKind,
    provider: input.provider,
    providerModel: input.providerModel,
    artifactKind: input.artifactKind,
    artifactStatus: 'partial',
    artifactText: null,
    artifactJson: input.artifactJson,
    rawResponseJson: input.rawResponseJson,
    sourceCaption: input.media.caption,
    sourceMimeType: input.media.mimeType,
    sourceFileSize: input.sourceFileSize,
    sourceDurationSeconds: null,
    recognitionLanguage: input.recognitionLanguage,
    confidenceJson: null,
    errorText: input.errorText,
    createdAt,
    expiresAt: addDaysIso(createdAt, deps.env.mediaArtifactRetentionDays)
  });
}
