import type { StoredMediaArtifact } from '../../../database/index.js';
import type {
  MediaMessageSnapshot,
  ReplyContext
} from '../../../domain/models.js';
import type { DescribeMediaContext } from '../../../llm/prompts.js';
import {
  artifactFromStoredMediaArtifact,
  buildTranscriptMediaContext,
  IMAGE_DESCRIPTION_ARTIFACT_KIND,
  IMAGE_DESCRIPTION_PROVIDER,
  IMAGE_INTERPRETATION_ARTIFACT_KIND,
  IMAGE_INTERPRETATION_PROVIDER,
  OCR_PROVIDER,
  OCR_TEXT_DEFAULT_ARTIFACT_KIND,
  OCR_TEXT_RU_ARTIFACT_KIND
} from '../helpers/media.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';

export function getCachedMediaContext(
  deps: Pick<ChatOrchestratorDeps, 'db'>,
  input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
  }
): DescribeMediaContext | null {
  if (
    input.media.mediaKind === 'photo' ||
    input.media.mediaKind === 'document_image'
  ) {
    const visionDescription =
      getCachedImageArtifact(deps, {
        request: input.request,
        media: input.media,
        provider: IMAGE_DESCRIPTION_PROVIDER,
        artifactKind: IMAGE_DESCRIPTION_ARTIFACT_KIND
      })?.artifactText ?? null;
    const ocrTextRu =
      getCachedImageArtifact(deps, {
        request: input.request,
        media: input.media,
        provider: OCR_PROVIDER,
        artifactKind: OCR_TEXT_RU_ARTIFACT_KIND
      })?.artifactText ?? null;
    const ocrTextDefault =
      getCachedImageArtifact(deps, {
        request: input.request,
        media: input.media,
        provider: OCR_PROVIDER,
        artifactKind: OCR_TEXT_DEFAULT_ARTIFACT_KIND
      })?.artifactText ?? null;
    const visionInterpretation =
      deps.db.getSuccessfulMediaArtifact({
        fileUniqueId: input.media.fileUniqueId,
        chatId: input.request.chatId,
        telegramMessageId: input.media.messageId,
        provider: IMAGE_INTERPRETATION_PROVIDER,
        artifactKind: IMAGE_INTERPRETATION_ARTIFACT_KIND
      })?.artifactText ?? null;
    const visionRaw =
      getCachedImageArtifact(deps, {
        request: input.request,
        media: input.media,
        provider: IMAGE_DESCRIPTION_PROVIDER,
        artifactKind: 'vision_raw'
      })?.artifactText ?? null;

    if (
      !visionInterpretation &&
      !visionDescription &&
      !ocrTextRu &&
      !ocrTextDefault &&
      !visionRaw
    ) {
      return null;
    }

    return {
      sourceCaption: input.media.caption,
      visionDescription,
      ocrTextRu,
      ocrTextDefault,
      visionRaw,
      visionInterpretation,
      audioTranscript: null
    };
  }

  const cached = deps.db.getSuccessfulMediaArtifact({
    fileUniqueId: input.media.fileUniqueId,
    chatId: input.request.chatId,
    telegramMessageId: input.media.messageId,
    provider: 'gladia',
    artifactKind: 'transcript'
  });

  if (!cached) {
    return null;
  }

  const recognized = artifactFromStoredMediaArtifact(cached.artifactJson);

  if (!recognized) {
    return null;
  }

  return buildTranscriptMediaContext({
    media: input.media,
    artifact: recognized.artifact,
    sourceDurationSeconds: recognized.sourceDurationSeconds
  });
}

export function getTargetMediaSnapshot(
  request: ReplyRequest,
  replyContext: ReplyContext
): MediaMessageSnapshot | null {
  return (
    request.replyToMediaSnapshot ??
    replyContext.replyAnchorMessage?.mediaSnapshot ??
    null
  );
}

export function getPreferredMediaSummary(
  artifacts: StoredMediaArtifact[],
  messageId: number,
  mediaKind: MediaMessageSnapshot['mediaKind']
): string | null {
  const matching = artifacts.filter(
    (artifact) => artifact.telegramMessageId === messageId
  );

  if (matching.length === 0) {
    return null;
  }

  if (mediaKind === 'photo' || mediaKind === 'document_image') {
    return (
      matching.find(
        (artifact) =>
          artifact.artifactKind === IMAGE_INTERPRETATION_ARTIFACT_KIND
      )?.artifactText ??
      matching.find(
        (artifact) => artifact.artifactKind === OCR_TEXT_RU_ARTIFACT_KIND
      )?.artifactText ??
      matching.find(
        (artifact) => artifact.artifactKind === OCR_TEXT_DEFAULT_ARTIFACT_KIND
      )?.artifactText ??
      matching.find(
        (artifact) => artifact.artifactKind === IMAGE_DESCRIPTION_ARTIFACT_KIND
      )?.artifactText ??
      matching.find((artifact) => artifact.artifactKind === 'vision_raw')
        ?.artifactText ??
      null
    );
  }

  return (
    matching.find((artifact) => artifact.artifactKind === 'transcript')
      ?.artifactText ?? null
  );
}

export function getCachedImageArtifact(
  deps: Pick<ChatOrchestratorDeps, 'db'>,
  input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    provider: string;
    artifactKind: string;
  }
): StoredMediaArtifact | null {
  return deps.db.getSuccessfulMediaArtifact({
    fileUniqueId: input.media.fileUniqueId,
    chatId: input.request.chatId,
    telegramMessageId: input.media.messageId,
    provider: input.provider,
    artifactKind: input.artifactKind
  });
}

export function getLatestImageArtifact(
  deps: Pick<ChatOrchestratorDeps, 'db'>,
  input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    provider: string;
    artifactKind: string;
  }
): StoredMediaArtifact | null {
  return deps.db.getLatestMediaArtifact({
    fileUniqueId: input.media.fileUniqueId,
    chatId: input.request.chatId,
    telegramMessageId: input.media.messageId,
    provider: input.provider,
    artifactKind: input.artifactKind
  });
}
