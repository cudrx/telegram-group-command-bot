import type { MediaMessageSnapshot } from '../../../domain/models.js';
import { language } from '../../../locales/locale.js';
import { type AppLogger, serializeError } from '../../../logging/logger.js';
import { downloadTelegramFileToTemp } from '../../../media/telegram-media.js';
import type { OcrLanguage } from '../../../media/types.js';
import {
  createMediaFilename,
  EMPTY_OCR_RESULT_MARKER,
  IMAGE_DESCRIPTION_ARTIFACT_KIND,
  IMAGE_DESCRIPTION_PROVIDER,
  OCR_PROVIDER,
  OCR_TEXT_DEFAULT_ARTIFACT_KIND,
  OCR_TEXT_RU_ARTIFACT_KIND
} from '../helpers/media.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';
import {
  saveImageArtifactMarker,
  saveImageTextArtifact
} from './image-artifacts.js';

export async function generateAndStoreImageAnalysis(
  deps: Pick<
    ChatOrchestratorDeps,
    | 'db'
    | 'env'
    | 'fetch'
    | 'now'
    | 'ocrProvider'
    | 'telegramFileApi'
    | 'visionProvider'
  >,
  input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
    missing: {
      visionDescription: boolean;
      ocrTextRu: boolean;
      ocrTextDefault: boolean;
    };
  }
): Promise<{
  visionDescription: string | null;
  ocrTextRu: string | null;
  ocrTextDefault: string | null;
}> {
  const telegramFileApi = deps.telegramFileApi;

  if (!telegramFileApi) {
    input.logger.warn('describe_telegram_file_api_missing');
    return { visionDescription: null, ocrTextRu: null, ocrTextDefault: null };
  }

  let downloaded: Awaited<
    ReturnType<typeof downloadTelegramFileToTemp>
  > | null = null;
  let visionDescription: string | null = null;
  let ocrTextRu: string | null = null;
  let ocrTextDefault: string | null = null;

  try {
    downloaded = await downloadTelegramFileToTemp({
      api: telegramFileApi,
      botToken: deps.env.telegramBotToken,
      fileId: input.media.fileId,
      filename: createMediaFilename(input.media),
      maxBytes: deps.env.mediaMaxFileBytes,
      fileSize: input.media.fileSize,
      fetch: deps.fetch
    });

    const sourceFileSize = input.media.fileSize ?? downloaded.bytes;
    const jobs: Promise<void>[] = [];

    if (input.missing.visionDescription) {
      jobs.push(
        (async () => {
          try {
            const result = await describeDownloadedImage(
              deps,
              downloaded.filePath
            );
            visionDescription = result.rawText;

            saveImageTextArtifact(deps, {
              request: input.request,
              media: input.media,
              provider: result.provider,
              providerModel: result.providerModel,
              artifactKind: IMAGE_DESCRIPTION_ARTIFACT_KIND,
              artifactText: result.rawText,
              rawResponseJson: result.rawResponse,
              recognitionLanguage: null,
              sourceFileSize
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

    if (input.missing.ocrTextRu) {
      jobs.push(
        (async () => {
          try {
            const result = await extractDownloadedImageOcr(
              deps,
              downloaded.filePath,
              language.ocrProviderLanguageCode
            );
            const text = result.text.trim();

            if (!text) {
              saveImageArtifactMarker(deps, {
                request: input.request,
                media: input.media,
                provider: result.provider,
                providerModel: result.providerModel,
                artifactKind: OCR_TEXT_RU_ARTIFACT_KIND,
                rawResponseJson: result.rawResponse,
                recognitionLanguage: result.language,
                sourceFileSize,
                errorText: EMPTY_OCR_RESULT_MARKER,
                artifactJson: { text: null, reason: EMPTY_OCR_RESULT_MARKER }
              });
              return;
            }

            ocrTextRu = text;
            saveImageTextArtifact(deps, {
              request: input.request,
              media: input.media,
              provider: result.provider,
              providerModel: result.providerModel,
              artifactKind: OCR_TEXT_RU_ARTIFACT_KIND,
              artifactText: text,
              rawResponseJson: result.rawResponse,
              recognitionLanguage: result.language,
              sourceFileSize
            });
          } catch (error) {
            input.logger.warn('ocr_media_recognition_failed', {
              provider: OCR_PROVIDER,
              artifactKind: OCR_TEXT_RU_ARTIFACT_KIND,
              mediaKind: input.media.mediaKind,
              ...serializeError(error)
            });
          }
        })()
      );
    }

    if (input.missing.ocrTextDefault) {
      jobs.push(
        (async () => {
          try {
            const result = await extractDownloadedImageOcr(
              deps,
              downloaded.filePath,
              null
            );
            const text = result.text.trim();

            if (!text) {
              saveImageArtifactMarker(deps, {
                request: input.request,
                media: input.media,
                provider: result.provider,
                providerModel: result.providerModel,
                artifactKind: OCR_TEXT_DEFAULT_ARTIFACT_KIND,
                rawResponseJson: result.rawResponse,
                recognitionLanguage: result.language,
                sourceFileSize,
                errorText: EMPTY_OCR_RESULT_MARKER,
                artifactJson: { text: null, reason: EMPTY_OCR_RESULT_MARKER }
              });
              return;
            }

            ocrTextDefault = text;
            saveImageTextArtifact(deps, {
              request: input.request,
              media: input.media,
              provider: result.provider,
              providerModel: result.providerModel,
              artifactKind: OCR_TEXT_DEFAULT_ARTIFACT_KIND,
              artifactText: text,
              rawResponseJson: result.rawResponse,
              recognitionLanguage: result.language,
              sourceFileSize
            });
          } catch (error) {
            input.logger.warn('ocr_media_recognition_failed', {
              provider: OCR_PROVIDER,
              artifactKind: OCR_TEXT_DEFAULT_ARTIFACT_KIND,
              mediaKind: input.media.mediaKind,
              ...serializeError(error)
            });
          }
        })()
      );
    }

    await Promise.allSettled(jobs);

    return { visionDescription, ocrTextRu, ocrTextDefault };
  } catch (error) {
    input.logger.warn('image_analysis_download_failed', {
      mediaKind: input.media.mediaKind,
      fileId: input.media.fileId,
      fileSize: input.media.fileSize,
      ...serializeError(error)
    });

    return { visionDescription: null, ocrTextRu: null, ocrTextDefault: null };
  } finally {
    if (downloaded) {
      try {
        await downloaded.cleanup();
      } catch (error) {
        input.logger.warn('image_download_cleanup_failed', {
          mediaKind: input.media.mediaKind,
          fileId: input.media.fileId,
          ...serializeError(error)
        });
      }
    }
  }
}

async function extractDownloadedImageOcr(
  deps: Pick<ChatOrchestratorDeps, 'env' | 'ocrProvider'>,
  filePath: string,
  language: OcrLanguage
): Promise<{
  provider: 'ocr_space';
  providerModel: string;
  text: string;
  language: OcrLanguage;
  rawResponse: unknown;
}> {
  if (!deps.ocrProvider) {
    throw new Error('OCR provider is not configured.');
  }

  return deps.ocrProvider.extractText({
    filePath,
    language,
    timeoutMs: deps.env.llmTimeoutMs
  });
}

async function describeDownloadedImage(
  deps: Pick<ChatOrchestratorDeps, 'env' | 'visionProvider'>,
  filePath: string
): Promise<{
  provider: 'cloudflare';
  providerModel: string;
  rawText: string;
  rawResponse: unknown;
  sourceDurationSeconds: null;
}> {
  if (!deps.visionProvider) {
    throw new Error('Vision provider is not configured.');
  }

  const result = await deps.visionProvider.describe({
    filePath,
    timeoutMs: deps.env.llmTimeoutMs
  });

  return {
    ...result,
    sourceDurationSeconds: null
  };
}
