import { memeActionConfig } from '../../../config/runtime/index.js';
import { text } from '../../../locales/locale.js';
import { serializeError } from '../../../logging/logger.js';
import { downloadInstagramReelWithYtDlp } from '../../actions/meme/instagram-reel-client.js';
import { fetchRedditPostCandidate } from '../../actions/meme/reddit-post-client.js';
import { dispatchMemeMedia } from '../../actions/meme/telegram-dispatcher.js';
import type { MemePostCandidate } from '../../actions/meme/types.js';
import {
  isDirectVideoTooLargeError,
  isDirectVideoTooLongError
} from '../../actions/meme/video-pipeline.js';
import { downloadYoutubeShortWithYtDlp } from '../../actions/meme/youtube-short-client.js';
import { downloadRedditVideoWithYtDlp } from '../../actions/meme/yt-dlp-client.js';
import { runWithProcessStatus } from '../../process-status.js';
import type { DirectMediaLinkKind } from '../direct-media-link.js';
import { dispatchTextReply } from '../outbound-voice.js';
import {
  type MemeJobInput,
  sendCandidate,
  sendDownloadedCandidate
} from './send.js';

export async function runDirectMediaMemeJob(
  input: MemeJobInput & {
    kind: DirectMediaLinkKind;
    text: string;
  }
): Promise<boolean> {
  if (input.kind === 'reddit') {
    return runDirectRedditVideoMemeJob(input);
  }

  if (input.kind === 'youtube_short') {
    return runDirectYoutubeShortMemeJob(input);
  }

  return runDirectInstagramReelMemeJob(input);
}

async function runDirectRedditVideoMemeJob(
  input: MemeJobInput & { text: string }
): Promise<boolean> {
  let candidate: MemePostCandidate | null;

  try {
    candidate = await fetchRedditPostCandidate({
      text: input.text,
      redditCookieHeaderPath: input.deps.env.redditCookieHeaderPath,
      sqlitePath: input.deps.env.sqlitePath,
      redditCookiesPath: input.deps.env.redditCookiesPath,
      ...(input.deps.fetch ? { fetch: input.deps.fetch } : {})
    });
  } catch (error) {
    input.logger.warn('reddit_video_resolution_failed', serializeError(error));

    try {
      const sentFallback = await runWithProcessStatus(
        input.deps,
        {
          chatId: input.request.chatId,
          status: {
            preset: 'video_pipeline'
          }
        },
        async (status) => {
          const fallback = await downloadRedditVideoWithYtDlp({
            text: input.text,
            sqlitePath: input.deps.env.sqlitePath,
            redditCookieHeaderPath: input.deps.env.redditCookieHeaderPath,
            redditCookiesPath: input.deps.env.redditCookiesPath,
            maxBytes: memeActionConfig.telegramMedia.videoMaxBytes,
            ...(input.deps.fetch ? { fetch: input.deps.fetch } : {}),
            processStatus: status,
            ...(input.deps.execFile ? { execFile: input.deps.execFile } : {})
          });

          if (!fallback) {
            return false;
          }

          await status.stage('upload');
          await sendDownloadedCandidate(
            input,
            fallback.candidate,
            fallback.downloaded,
            {
              reply: false
            }
          );

          return true;
        }
      );
      if (!sentFallback) return false;
    } catch (fallbackError) {
      if (await handleDirectVideoFailure(input, fallbackError)) {
        return true;
      }

      input.logger.warn(
        'reddit_video_ytdlp_failed',
        serializeError(fallbackError)
      );
      return false;
    }

    await deleteSourceMessage(input);
    return true;
  }

  if (!candidate) return false;

  try {
    await sendCandidate(input, candidate, { reply: false });
  } catch (error) {
    if (await handleDirectVideoFailure(input, error)) {
      return true;
    }

    throw error;
  }

  await deleteSourceMessage(input);
  return true;
}

async function runDirectYoutubeShortMemeJob(
  input: MemeJobInput & { text: string }
): Promise<boolean> {
  let short: Awaited<ReturnType<typeof downloadYoutubeShortWithYtDlp>>;

  try {
    short = await runWithProcessStatus(
      input.deps,
      {
        chatId: input.request.chatId,
        status: {
          preset: 'video_pipeline'
        }
      },
      (status) =>
        downloadYoutubeShortWithYtDlp({
          text: input.text,
          sqlitePath: input.deps.env.sqlitePath,
          youtubeCookiesPath: input.deps.env.youtubeCookiesPath,
          maxBytes: memeActionConfig.telegramMedia.videoMaxBytes,
          captionMaxLength: memeActionConfig.caption.maxLength,
          processStatus: status,
          ...(input.deps.execFile ? { execFile: input.deps.execFile } : {})
        })
    );
  } catch (error) {
    if (await handleDirectVideoFailure(input, error)) {
      return true;
    }

    input.logger.warn('youtube_short_ytdlp_failed', serializeError(error));
    return false;
  }

  if (!short) return false;

  try {
    const sent = await runWithProcessStatus(
      input.deps,
      {
        chatId: input.request.chatId,
        status: {
          preset: 'video_pipeline',
          startStage: 'upload'
        }
      },
      async (status) => {
        await status.stage('upload');

        return dispatchMemeMedia({
          memeDispatcher: input.deps.memeDispatcher,
          chatId: input.request.chatId,
          replyToMessageId: null,
          reply: false,
          caption: short.caption,
          media: short.downloaded
        });
      }
    );

    input.deps.db.saveBotMessage({
      chatId: input.request.chatId,
      chatType: input.request.chatType,
      chatTitle: input.request.chatTitle,
      messageId: sent.messageId,
      text: short.caption,
      createdAt: sent.createdAt,
      userId: input.deps.bot.userId,
      username: input.deps.bot.username,
      displayName: input.deps.bot.displayName,
      replyToMessageId: null,
      outputMode: 'text',
      mediaSnapshot: sent.mediaSnapshot ?? null
    });

    const storedMessage = input.deps.db.getMessageByTelegramMessageId(
      input.request.chatId,
      sent.messageId
    );

    if (storedMessage) {
      input.mediaSupport?.startAutoReadForIncomingMessage(
        storedMessage,
        input.logger
      );
    }
  } catch (error) {
    if (await handleDirectVideoFailure(input, error)) {
      return true;
    }

    input.logger.warn('youtube_short_dispatch_failed', serializeError(error));
    return true;
  } finally {
    await short.downloaded.cleanup();
  }

  await deleteSourceMessage(input);
  return true;
}

async function runDirectInstagramReelMemeJob(
  input: MemeJobInput & { text: string }
): Promise<boolean> {
  let reel: Awaited<ReturnType<typeof downloadInstagramReelWithYtDlp>>;

  try {
    reel = await runWithProcessStatus(
      input.deps,
      {
        chatId: input.request.chatId,
        status: {
          preset: 'video_pipeline'
        }
      },
      (status) =>
        downloadInstagramReelWithYtDlp({
          text: input.text,
          sqlitePath: input.deps.env.sqlitePath,
          instagramCookiesPath: input.deps.env.instagramCookiesPath,
          maxBytes: memeActionConfig.telegramMedia.videoMaxBytes,
          captionMaxLength: memeActionConfig.caption.maxLength,
          processStatus: status,
          ...(input.deps.execFile ? { execFile: input.deps.execFile } : {})
        })
    );
  } catch (error) {
    if (await handleDirectVideoFailure(input, error)) {
      return true;
    }

    input.logger.warn('instagram_reel_ytdlp_failed', serializeError(error));
    return false;
  }

  if (!reel) return false;

  try {
    const sent = await runWithProcessStatus(
      input.deps,
      {
        chatId: input.request.chatId,
        status: {
          preset: 'video_pipeline',
          startStage: 'upload'
        }
      },
      async (status) => {
        await status.stage('upload');

        return dispatchMemeMedia({
          memeDispatcher: input.deps.memeDispatcher,
          chatId: input.request.chatId,
          replyToMessageId: null,
          reply: false,
          caption: reel.caption,
          media: reel.downloaded
        });
      }
    );

    input.deps.db.saveBotMessage({
      chatId: input.request.chatId,
      chatType: input.request.chatType,
      chatTitle: input.request.chatTitle,
      messageId: sent.messageId,
      text: reel.caption,
      createdAt: sent.createdAt,
      userId: input.deps.bot.userId,
      username: input.deps.bot.username,
      displayName: input.deps.bot.displayName,
      replyToMessageId: null,
      outputMode: 'text',
      mediaSnapshot: sent.mediaSnapshot ?? null
    });

    const storedMessage = input.deps.db.getMessageByTelegramMessageId(
      input.request.chatId,
      sent.messageId
    );

    if (storedMessage) {
      input.mediaSupport?.startAutoReadForIncomingMessage(
        storedMessage,
        input.logger
      );
    }
  } catch (error) {
    if (await handleDirectVideoFailure(input, error)) {
      return true;
    }

    input.logger.warn('instagram_reel_dispatch_failed', serializeError(error));
    return true;
  } finally {
    await reel.downloaded.cleanup();
  }

  await deleteSourceMessage(input);
  return true;
}

async function deleteSourceMessage(
  input: Pick<MemeJobInput, 'deps' | 'request' | 'logger'>
): Promise<void> {
  try {
    await input.deps.deleteMessageDispatcher({
      chatId: input.request.chatId,
      messageId: input.request.triggerMessageId
    });
  } catch (error) {
    input.logger.warn(
      'reddit_video_source_delete_failed',
      serializeError(error)
    );
  }
}

async function handleDirectVideoFailure(
  input: MemeJobInput,
  error: unknown
): Promise<boolean> {
  if (isDirectVideoTooLongError(error)) {
    await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: text.meme.directVideoTooLongFallback(
        Math.floor(error.maxDurationSeconds / 60)
      )
    });
    return true;
  }

  if (isDirectVideoTooLargeError(error)) {
    await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: text.meme.directVideoTooLargeFallback(
        Math.floor(error.maxBytes / 1_000_000)
      )
    });
    return true;
  }

  if (isTelegramRequestEntityTooLargeError(error)) {
    await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: text.meme.directVideoTooLargeFallback(
        Math.floor(memeActionConfig.telegramMedia.videoMaxBytes / 1_000_000)
      )
    });
    return true;
  }

  return false;
}

function isTelegramRequestEntityTooLargeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'error_code' in error &&
    error.error_code === 413
  );
}
