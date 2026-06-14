import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { text } from '../../../locales/locale.js';
import { type AppLogger, serializeError } from '../../../logging/logger.js';
import {
  execMediaFileDefault,
  MEDIA_EXEC_MAX_BUFFER
} from '../../../media/exec.js';
import { downloadTelegramFileToTemp } from '../../../media/telegram-media.js';
import { createMediaFilename } from '../../chat-orchestrator/helpers/media.js';
import { dispatchTextReply } from '../../chat-orchestrator/outbound-voice.js';
import type {
  ChatOrchestratorDeps,
  ReplyRequest
} from '../../chat-orchestrator/types.js';
import { runWithProcessStatus } from '../../process-status.js';

const FFMPEG_BIN = 'ffmpeg';
const TRANSCRIBE_AUDIO_FILENAME = 'transcribe-audio.ogg';

export async function runTranscribeVideoJob(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  logger: AppLogger;
}): Promise<void> {
  const media =
    input.request.replyToMediaSnapshot ??
    input.request.replyToMessageSnapshot?.mediaSnapshot ??
    null;

  if (media?.mediaKind !== 'video') {
    await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: text.transcribe.usageFallback
    });
    return;
  }

  if (!input.deps.telegramFileApi || !input.deps.speechToTextProvider) {
    await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: text.transcribe.unavailableFallback
    });
    return;
  }

  const telegramFileApi = input.deps.telegramFileApi;
  const speechToTextProvider = input.deps.speechToTextProvider;

  let cleanupDownloaded: (() => Promise<void>) | null = null;
  let audioTempDirectory: string | null = null;

  try {
    await runWithProcessStatus(
      input.deps,
      {
        chatId: input.request.chatId,
        replyToMessageId: input.request.triggerMessageId,
        status: {
          preset: 'transcription'
        }
      },
      async (status) => {
        await status.stage('download');
        const downloadedMedia = await downloadTelegramFileToTemp({
          api: telegramFileApi,
          botToken: input.deps.env.telegramBotToken,
          fileId: media.fileId,
          filename: createMediaFilename(media),
          maxBytes: input.deps.env.mediaMaxFileBytes,
          fileSize: media.fileSize,
          fetch: input.deps.fetch
        });
        cleanupDownloaded = downloadedMedia.cleanup;
        audioTempDirectory = await mkdtemp(
          path.join(os.tmpdir(), 'transcribe-audio-')
        );
        const audioPath = path.join(
          audioTempDirectory,
          TRANSCRIBE_AUDIO_FILENAME
        );
        const execFile = input.deps.execFile ?? execMediaFileDefault;

        await status.stage('extract_audio');
        await execFile(
          FFMPEG_BIN,
          [
            '-y',
            '-i',
            downloadedMedia.filePath,
            '-vn',
            '-ac',
            '1',
            '-c:a',
            'libopus',
            '-b:a',
            '32k',
            audioPath
          ],
          { cwd: audioTempDirectory, maxBuffer: MEDIA_EXEC_MAX_BUFFER }
        );

        await status.stage('transcribe');
        const result = await speechToTextProvider.transcribe({
          filePath: audioPath,
          filename: `transcribe-video-${media.messageId}.ogg`,
          mimeType: 'audio/ogg',
          timeoutMs: input.deps.env.llmTimeoutMs
        });
        const transcript = result.artifact.transcript.trim();

        await status.stage('reply');
        await dispatchTextReply({
          deps: input.deps,
          request: input.request,
          text:
            transcript.length > 0 ? transcript : text.transcribe.emptyFallback
        });
      }
    );
  } catch (error) {
    input.logger.warn('transcribe_video_failed', {
      mediaKind: media.mediaKind,
      fileId: media.fileId,
      ...serializeError(error)
    });
    await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: text.transcribe.failedFallback
    });
  } finally {
    const cleanupDownloadedMedia = cleanupDownloaded;

    if (typeof cleanupDownloadedMedia === 'function') {
      try {
        await (cleanupDownloadedMedia as () => Promise<void>)();
      } catch (error) {
        input.logger.warn('transcribe_video_download_cleanup_failed', {
          fileId: media.fileId,
          ...serializeError(error)
        });
      }
    }

    if (audioTempDirectory) {
      try {
        await rm(audioTempDirectory, { recursive: true, force: true });
      } catch (error) {
        input.logger.warn('transcribe_audio_cleanup_failed', {
          fileId: media.fileId,
          ...serializeError(error)
        });
      }
    }
  }
}
