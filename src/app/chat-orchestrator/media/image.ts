import type { MediaMessageSnapshot } from '../../../domain/models.js';
import type { DescribeMediaContext } from '../../../llm/prompts.js';
import { type AppLogger, serializeError } from '../../../logging/logger.js';
import {
  IMAGE_DESCRIPTION_ARTIFACT_KIND,
  IMAGE_DESCRIPTION_PROVIDER,
  IMAGE_INTERPRETATION_ARTIFACT_KIND,
  IMAGE_INTERPRETATION_PROVIDER,
  isEmptyOcrResultMarker,
  OCR_PROVIDER,
  OCR_TEXT_DEFAULT_ARTIFACT_KIND,
  OCR_TEXT_RU_ARTIFACT_KIND
} from '../helpers.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';
import { getCachedImageArtifact, getLatestImageArtifact } from './cache.js';
import { generateAndStoreImageAnalysis } from './image-analysis.js';
import { generateAndStoreVisionInterpretation } from './image-interpretation.js';

export async function ensureImageMediaContext(
  deps: Pick<
    ChatOrchestratorDeps,
    | 'db'
    | 'env'
    | 'fetch'
    | 'now'
    | 'ocrProvider'
    | 'qwen'
    | 'telegramFileApi'
    | 'visionProvider'
  >,
  input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
  }
): Promise<DescribeMediaContext | null> {
  const cachedInterpretation =
    deps.db.getSuccessfulMediaArtifact({
      fileUniqueId: input.media.fileUniqueId,
      chatId: input.request.chatId,
      telegramMessageId: input.media.messageId,
      provider: IMAGE_INTERPRETATION_PROVIDER,
      artifactKind: IMAGE_INTERPRETATION_ARTIFACT_KIND
    })?.artifactText ?? null;

  let visionDescription =
    getCachedImageArtifact(deps, {
      request: input.request,
      media: input.media,
      provider: IMAGE_DESCRIPTION_PROVIDER,
      artifactKind: IMAGE_DESCRIPTION_ARTIFACT_KIND
    })?.artifactText ?? null;
  let ocrTextRu =
    getCachedImageArtifact(deps, {
      request: input.request,
      media: input.media,
      provider: OCR_PROVIDER,
      artifactKind: OCR_TEXT_RU_ARTIFACT_KIND
    })?.artifactText ?? null;
  let ocrTextDefault =
    getCachedImageArtifact(deps, {
      request: input.request,
      media: input.media,
      provider: OCR_PROVIDER,
      artifactKind: OCR_TEXT_DEFAULT_ARTIFACT_KIND
    })?.artifactText ?? null;
  const visionRaw =
    getCachedImageArtifact(deps, {
      request: input.request,
      media: input.media,
      provider: IMAGE_DESCRIPTION_PROVIDER,
      artifactKind: 'vision_raw'
    })?.artifactText ?? null;

  const hasUsefulCachedImageArtifact = Boolean(
    cachedInterpretation ||
      visionDescription ||
      ocrTextRu ||
      ocrTextDefault ||
      visionRaw
  );

  const hasEmptyOcrTextRuMarker = isEmptyOcrResultMarker(
    getLatestImageArtifact(deps, {
      request: input.request,
      media: input.media,
      provider: OCR_PROVIDER,
      artifactKind: OCR_TEXT_RU_ARTIFACT_KIND
    })
  );
  const hasEmptyOcrTextDefaultMarker = isEmptyOcrResultMarker(
    getLatestImageArtifact(deps, {
      request: input.request,
      media: input.media,
      provider: OCR_PROVIDER,
      artifactKind: OCR_TEXT_DEFAULT_ARTIFACT_KIND
    })
  );

  const missing = {
    visionDescription: !visionDescription && Boolean(deps.visionProvider),
    ocrTextRu:
      !ocrTextRu && !hasEmptyOcrTextRuMarker && Boolean(deps.ocrProvider),
    ocrTextDefault:
      !ocrTextDefault &&
      !hasEmptyOcrTextDefaultMarker &&
      Boolean(deps.ocrProvider)
  };

  if (
    missing.visionDescription ||
    missing.ocrTextRu ||
    missing.ocrTextDefault
  ) {
    try {
      const generated = await generateAndStoreImageAnalysis(deps, {
        ...input,
        missing
      });

      visionDescription = visionDescription ?? generated.visionDescription;
      ocrTextRu = ocrTextRu ?? generated.ocrTextRu;
      ocrTextDefault = ocrTextDefault ?? generated.ocrTextDefault;
    } catch (error) {
      input.logger.warn('image_analysis_failed', {
        mediaKind: input.media.mediaKind,
        fileId: input.media.fileId,
        hasUsefulCachedImageArtifact,
        ...serializeError(error)
      });
    }
  }

  if (
    !cachedInterpretation &&
    !visionDescription &&
    !ocrTextRu &&
    !ocrTextDefault &&
    !visionRaw
  ) {
    return null;
  }

  let visionInterpretation: string | null = cachedInterpretation;
  const hasNewAnalysis = Boolean(
    visionDescription || ocrTextRu || ocrTextDefault
  );

  if (!visionInterpretation && hasNewAnalysis) {
    try {
      visionInterpretation = await generateAndStoreVisionInterpretation(deps, {
        request: input.request,
        media: input.media,
        visionDescription,
        ocrTextRu,
        ocrTextDefault
      });
    } catch (error) {
      input.logger.warn('image_interpretation_failed', {
        provider: IMAGE_INTERPRETATION_PROVIDER,
        mediaKind: input.media.mediaKind,
        ...serializeError(error)
      });
      visionInterpretation = null;
    }
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
