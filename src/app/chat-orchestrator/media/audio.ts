import type { AppLogger } from '../../../logging/logger.js';
import { serializeError } from '../../../logging/logger.js';
import { downloadTelegramFileToTemp } from '../../../media/telegram-media.js';
import type { MediaMessageSnapshot } from '../../../domain/models.js';
import type { DescribeMediaContext } from '../../../llm/prompts.js';
import type { NormalizedMediaArtifact } from '../../../media/types.js';
import {
  addDaysIso,
  artifactFromStoredMediaArtifact,
  artifactToText,
  buildTranscriptMediaContext,
  createMediaFilename
} from '../helpers.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';

export async function ensureAudioMediaContext(
  deps: Pick<
    ChatOrchestratorDeps,
    'db' | 'env' | 'fetch' | 'now' | 'speechToTextProvider' | 'telegramFileApi'
  >,
  input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
  }
): Promise<DescribeMediaContext | null> {
  const cached = deps.db.getSuccessfulMediaArtifact({
    fileUniqueId: input.media.fileUniqueId,
    chatId: input.request.chatId,
    telegramMessageId: input.media.messageId,
    provider: 'gladia',
    artifactKind: 'transcript'
  });
  const recognized = cached
    ? artifactFromStoredMediaArtifact(cached.artifactJson)
    : await recognizeAndStoreTranscript(deps, input);

  if (!recognized) {
    return null;
  }

  return buildTranscriptMediaContext({
    media: input.media,
    artifact: recognized.artifact,
    sourceDurationSeconds: recognized.sourceDurationSeconds
  });
}

async function recognizeAndStoreTranscript(
  deps: Pick<
    ChatOrchestratorDeps,
    'db' | 'env' | 'fetch' | 'now' | 'speechToTextProvider' | 'telegramFileApi'
  >,
  input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
  }
): Promise<{
  artifact: NormalizedMediaArtifact;
  sourceDurationSeconds: number | null;
} | null> {
  const telegramFileApi = deps.telegramFileApi;

  if (!telegramFileApi) {
    input.logger.warn('describe_telegram_file_api_missing');
    return null;
  }

  let downloaded: Awaited<
    ReturnType<typeof downloadTelegramFileToTemp>
  > | null = null;

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

    const result = await transcribeDownloadedMedia(
      deps,
      input.media,
      downloaded.filePath
    );
    const createdAt = deps.now();

    deps.db.saveMediaArtifact({
      fileUniqueId: input.media.fileUniqueId,
      chatId: input.request.chatId,
      telegramMessageId: input.media.messageId,
      mediaKind: input.media.mediaKind,
      provider: result.provider,
      providerModel: result.providerModel,
      artifactKind: 'transcript',
      artifactStatus: 'success',
      artifactText: artifactToText(result.artifact),
      artifactJson: result.artifact,
      rawResponseJson: result.rawResponse,
      sourceCaption: input.media.caption,
      sourceMimeType: input.media.mimeType,
      sourceFileSize: input.media.fileSize ?? downloaded.bytes,
      sourceDurationSeconds: result.sourceDurationSeconds ?? null,
      recognitionLanguage:
        result.artifact.type === 'transcript' ? result.artifact.language : null,
      confidenceJson: null,
      errorText: null,
      createdAt,
      expiresAt: addDaysIso(createdAt, deps.env.mediaArtifactRetentionDays)
    });

    return {
      artifact: result.artifact,
      sourceDurationSeconds: result.sourceDurationSeconds ?? null
    };
  } catch (error) {
    input.logger.warn('describe_media_recognition_failed', {
      provider: 'gladia',
      mediaKind: input.media.mediaKind,
      ...serializeError(error)
    });
    return null;
  } finally {
    if (downloaded) {
      try {
        await downloaded.cleanup();
      } catch (error) {
        input.logger.warn('media_download_cleanup_failed', {
          provider: 'gladia',
          mediaKind: input.media.mediaKind,
          fileId: input.media.fileId,
          ...serializeError(error)
        });
      }
    }
  }
}

async function transcribeDownloadedMedia(
  deps: Pick<ChatOrchestratorDeps, 'env' | 'speechToTextProvider'>,
  media: MediaMessageSnapshot,
  filePath: string
): Promise<{
  provider: 'gladia';
  providerModel: string;
  artifact: NormalizedMediaArtifact;
  rawResponse: unknown;
  sourceDurationSeconds: number | null;
}> {
  if (!deps.speechToTextProvider) {
    throw new Error('Speech-to-text provider is not configured.');
  }

  return deps.speechToTextProvider.transcribe({
    filePath,
    filename: createMediaFilename(media),
    mimeType: media.mimeType ?? 'application/octet-stream',
    timeoutMs: deps.env.llmTimeoutMs
  });
}
