import type { MediaMessageSnapshot } from '../../../domain/models.js';
import { type AppLogger, serializeError } from '../../../logging/logger.js';
import {
  EMPTY_OCR_RESULT_MARKER,
  IMAGE_DESCRIPTION_ARTIFACT_KIND,
  IMAGE_DESCRIPTION_PROVIDER,
  OCR_PROVIDER,
  OCR_TEXT_DEFAULT_ARTIFACT_KIND,
  OCR_TEXT_RU_ARTIFACT_KIND
} from '../../chat-orchestrator/helpers/media.js';
import {
  saveImageArtifactMarker,
  saveImageTextArtifact
} from '../../chat-orchestrator/media/image-artifacts.js';
import { generateAndStoreVisionInterpretation } from '../../chat-orchestrator/media/image-interpretation.js';
import type {
  ChatOrchestratorDeps,
  ReplyRequest
} from '../../chat-orchestrator/types.js';
import type { ExtractedAnimationFrame } from './frame-extractor.js';

export async function recognizeMemeAnimationFrame(input: {
  deps: Pick<
    ChatOrchestratorDeps,
    'db' | 'env' | 'now' | 'ocrProvider' | 'qwen' | 'visionProvider'
  >;
  request: ReplyRequest;
  media: MediaMessageSnapshot;
  frame: ExtractedAnimationFrame;
  logger: AppLogger;
}): Promise<void> {
  let visionDescription: string | null = null;
  let ocrTextRu: string | null = null;
  let ocrTextDefault: string | null = null;
  const jobs: Promise<void>[] = [];

  if (input.deps.visionProvider) {
    jobs.push(
      (async () => {
        try {
          const result = await input.deps.visionProvider?.describe({
            filePath: input.frame.filePath,
            timeoutMs: input.deps.env.llmTimeoutMs
          });

          if (!result) return;

          visionDescription = result.rawText;
          saveImageTextArtifact(input.deps, {
            request: input.request,
            media: input.media,
            provider: result.provider,
            providerModel: result.providerModel,
            artifactKind: IMAGE_DESCRIPTION_ARTIFACT_KIND,
            artifactText: result.rawText,
            rawResponseJson: result.rawResponse,
            recognitionLanguage: null,
            sourceFileSize: input.frame.bytes
          });
        } catch (error) {
          input.logger.warn('describe_media_recognition_failed', {
            provider: IMAGE_DESCRIPTION_PROVIDER,
            mediaKind: input.media.mediaKind,
            ...serializeError(error)
          });
        }
      })()
    );
  }

  if (input.deps.ocrProvider) {
    jobs.push(
      extractFrameOcr({
        ...input,
        language: 'rus',
        artifactKind: OCR_TEXT_RU_ARTIFACT_KIND,
        setText: (text) => {
          ocrTextRu = text;
        }
      })
    );
    jobs.push(
      extractFrameOcr({
        ...input,
        language: null,
        artifactKind: OCR_TEXT_DEFAULT_ARTIFACT_KIND,
        setText: (text) => {
          ocrTextDefault = text;
        }
      })
    );
  }

  await Promise.allSettled(jobs);

  if (visionDescription || ocrTextRu || ocrTextDefault) {
    try {
      await generateAndStoreVisionInterpretation(input.deps, {
        request: input.request,
        media: input.media,
        visionDescription,
        ocrTextRu,
        ocrTextDefault
      });
    } catch (error) {
      input.logger.warn('image_interpretation_failed', {
        provider: 'qwen',
        mediaKind: input.media.mediaKind,
        ...serializeError(error)
      });
    }
  }
}

async function extractFrameOcr(input: {
  deps: Pick<ChatOrchestratorDeps, 'db' | 'env' | 'now' | 'ocrProvider'>;
  request: ReplyRequest;
  media: MediaMessageSnapshot;
  frame: ExtractedAnimationFrame;
  logger: AppLogger;
  language: 'rus' | null;
  artifactKind: string;
  setText: (text: string) => void;
}): Promise<void> {
  try {
    const result = await input.deps.ocrProvider?.extractText({
      filePath: input.frame.filePath,
      language: input.language,
      timeoutMs: input.deps.env.llmTimeoutMs
    });

    if (!result) return;

    const text = result.text.trim();

    if (!text) {
      saveImageArtifactMarker(input.deps, {
        request: input.request,
        media: input.media,
        provider: result.provider,
        providerModel: result.providerModel,
        artifactKind: input.artifactKind,
        rawResponseJson: result.rawResponse,
        recognitionLanguage: result.language,
        sourceFileSize: input.frame.bytes,
        errorText: EMPTY_OCR_RESULT_MARKER,
        artifactJson: { text: null, reason: EMPTY_OCR_RESULT_MARKER }
      });
      return;
    }

    input.setText(text);
    saveImageTextArtifact(input.deps, {
      request: input.request,
      media: input.media,
      provider: result.provider,
      providerModel: result.providerModel,
      artifactKind: input.artifactKind,
      artifactText: text,
      rawResponseJson: result.rawResponse,
      recognitionLanguage: result.language,
      sourceFileSize: input.frame.bytes
    });
  } catch (error) {
    input.logger.warn('ocr_media_recognition_failed', {
      provider: OCR_PROVIDER,
      artifactKind: input.artifactKind,
      mediaKind: input.media.mediaKind,
      ...serializeError(error)
    });
  }
}
