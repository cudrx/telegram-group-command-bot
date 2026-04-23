import { loadPrompt } from '../../../llm/prompt-files.js';
import type { DescribeMediaContext } from '../../../llm/prompts.js';
import { serializeError, type AppLogger } from '../../../logging/logger.js';
import { downloadTelegramFileToTemp } from '../../../media/telegram-media.js';
import type { MediaMessageSnapshot } from '../../../domain/models.js';
import {
  EMPTY_OCR_RESULT_MARKER,
  IMAGE_DESCRIPTION_ARTIFACT_KIND,
  IMAGE_DESCRIPTION_PROVIDER,
  IMAGE_INTERPRETATION_ARTIFACT_KIND,
  IMAGE_INTERPRETATION_PROVIDER,
  OCR_PROVIDER,
  OCR_TEXT_DEFAULT_ARTIFACT_KIND,
  OCR_TEXT_RU_ARTIFACT_KIND,
  addDaysIso,
  createMediaFilename,
  isEmptyOcrResultMarker
} from '../helpers.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';
import { getCachedImageArtifact, getLatestImageArtifact } from './cache.js';

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
    visionDescription: !visionDescription,
    ocrTextRu: !ocrTextRu && !hasEmptyOcrTextRuMarker,
    ocrTextDefault: !ocrTextDefault && !hasEmptyOcrTextDefaultMarker
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

function saveImageTextArtifact(
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

function saveImageArtifactMarker(
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

async function extractDownloadedImageOcr(
  deps: Pick<ChatOrchestratorDeps, 'env' | 'ocrProvider'>,
  filePath: string,
  language: 'rus' | null
): Promise<{
  provider: 'ocr_space';
  providerModel: string;
  text: string;
  language: 'rus' | null;
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

async function generateAndStoreImageAnalysis(
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
              'rus'
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

async function generateAndStoreVisionInterpretation(
  deps: Pick<ChatOrchestratorDeps, 'db' | 'env' | 'now' | 'qwen'>,
  input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    visionDescription: string | null;
    ocrTextRu: string | null;
    ocrTextDefault: string | null;
  }
): Promise<string | null> {
  const result = await deps.qwen.generateReply({
    assistantInstructions: loadPrompt('base'),
    targetDisplayName: input.request.fromDisplayName,
    intent: 'read',
    replyContext: {
      triggerMessage: {
        chatId: input.request.chatId,
        messageId: input.media.messageId,
        userId: null,
        senderDisplayName: 'Media',
        text: '/read',
        createdAt: input.request.createdAt,
        isBot: false,
        replyToMessageId: null
      },
      replyAnchorMessage: null,
      priorContextMessages: []
    },
    lookupContext: null,
    mediaContext: {
      sourceCaption: input.media.caption,
      visionDescription: input.visionDescription,
      ocrTextRu: input.ocrTextRu,
      ocrTextDefault: input.ocrTextDefault,
      visionRaw: null,
      visionInterpretation: null,
      audioTranscript: null
    }
  });
  const createdAt = deps.now();

  deps.db.saveMediaArtifact({
    fileUniqueId: input.media.fileUniqueId,
    chatId: input.request.chatId,
    telegramMessageId: input.media.messageId,
    mediaKind: input.media.mediaKind,
    provider: IMAGE_INTERPRETATION_PROVIDER,
    providerModel: result.model,
    artifactKind: IMAGE_INTERPRETATION_ARTIFACT_KIND,
    artifactStatus: 'success',
    artifactText: result.text,
    artifactJson: { text: result.text },
    rawResponseJson: {
      model: result.model,
      latencyMs: result.latencyMs,
      attemptCount: result.attemptCount,
      promptTokensEstimate: result.promptTokensEstimate
    },
    sourceCaption: input.media.caption,
    sourceMimeType: input.media.mimeType,
    sourceFileSize: input.media.fileSize,
    sourceDurationSeconds: null,
    recognitionLanguage: null,
    confidenceJson: null,
    errorText: null,
    createdAt,
    expiresAt: addDaysIso(createdAt, deps.env.mediaArtifactRetentionDays)
  });

  return result.text;
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
