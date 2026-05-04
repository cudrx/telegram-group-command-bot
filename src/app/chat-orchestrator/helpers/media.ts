import type { StoredMediaArtifact } from '../../../database/index.js';
import type { MediaMessageSnapshot } from '../../../domain/models.js';
import type { DescribeMediaContext } from '../../../llm/prompts.js';
import type { NormalizedMediaArtifact } from '../../../media/types.js';

export const NEARBY_MEDIA_SCAN_LIMIT = 10;
export const IMAGE_DESCRIPTION_PROVIDER = 'cloudflare';
export const IMAGE_DESCRIPTION_ARTIFACT_KIND = 'vision_description';
export const OCR_PROVIDER = 'ocr_space';
export const OCR_TEXT_RU_ARTIFACT_KIND = 'ocr_text_ru';
export const OCR_TEXT_DEFAULT_ARTIFACT_KIND = 'ocr_text_default';
export const IMAGE_INTERPRETATION_PROVIDER = 'deepseek';
export const IMAGE_INTERPRETATION_ARTIFACT_KIND = 'vision_interpretation';
export const EMPTY_OCR_RESULT_MARKER = 'empty_result';
export const AUTO_READ_MAX_ATTEMPTS = 2;
export const AUTO_READ_FAILED_PROVIDER = 'auto_read';
export const AUTO_READ_FAILED_MODEL = 'auto_read';
export const AUTO_READ_FAILED_ARTIFACT_KIND = 'auto_read';
export const AUTO_READ_FAILED_ERROR_TEXT_MAX_LENGTH = 500;

export function artifactFromStoredMediaArtifact(input: unknown): {
  artifact: NormalizedMediaArtifact;
  sourceDurationSeconds: number | null;
} | null {
  if (!input || typeof input !== 'object' || !('type' in input)) {
    return null;
  }

  const artifact = input as NormalizedMediaArtifact;

  return {
    artifact,
    sourceDurationSeconds:
      artifact.type === 'transcript' ? artifact.duration : null
  };
}

export function buildTranscriptMediaContext(input: {
  media: MediaMessageSnapshot;
  artifact: NormalizedMediaArtifact;
  sourceDurationSeconds: number | null;
}): DescribeMediaContext {
  return {
    sourceCaption: input.media.caption,
    visionDescription: null,
    ocrTextRu: null,
    ocrTextDefault: null,
    visionRaw: null,
    visionInterpretation: null,
    audioTranscript: {
      transcript: input.artifact.transcript,
      language: input.artifact.language,
      sourceDurationSeconds: input.sourceDurationSeconds
    }
  };
}

export function artifactToText(
  artifact: NormalizedMediaArtifact
): string | null {
  return artifact.transcript;
}

export function appendMediaSummaryToMessageText(
  text: string,
  summary: string
): string {
  const trimmedSummary = summary.trim();

  if (trimmedSummary.length === 0) {
    return text;
  }

  if (text.trim().length === 0) {
    return `[media] ${trimmedSummary}`;
  }

  return `${text}\n[media] ${trimmedSummary}`;
}

export function createMediaFilename(media: MediaMessageSnapshot): string {
  return `${media.mediaKind}-${media.messageId}${getMediaExtension(media)}`;
}

export function addDaysIso(value: string, days: number): string {
  return new Date(
    new Date(value).getTime() + days * 24 * 60 * 60 * 1000
  ).toISOString();
}

export function toShortErrorText(error: Error): string {
  return error.message.slice(0, AUTO_READ_FAILED_ERROR_TEXT_MAX_LENGTH);
}

export function isEmptyOcrResultMarker(
  artifact: StoredMediaArtifact | null
): boolean {
  return Boolean(
    artifact &&
      artifact.artifactStatus === 'partial' &&
      artifact.errorText === EMPTY_OCR_RESULT_MARKER
  );
}

function getMediaExtension(media: MediaMessageSnapshot): string {
  const mime = media.mimeType ?? '';

  if (mime === 'audio/ogg') {
    return '.ogg';
  }

  if (mime === 'audio/mpeg') {
    return '.mp3';
  }

  if (mime === 'video/mp4') {
    return '.mp4';
  }

  if (mime === 'image/png') {
    return '.png';
  }

  if (mime === 'image/webp') {
    return '.webp';
  }

  if (mime === 'image/jpeg' || media.mediaKind === 'photo') {
    return '.jpg';
  }

  return '.bin';
}
