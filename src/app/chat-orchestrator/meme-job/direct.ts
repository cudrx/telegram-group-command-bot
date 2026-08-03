import { memeActionConfig } from '../../../config/runtime/index.js';
import { text } from '../../../locales/locale.js';
import { serializeError } from '../../../logging/logger.js';
import {
  downloadInstagramReelWithYtDlp,
  extractInstagramErrorText
} from '../../actions/meme/instagram-reel-client.js';
import { fetchRedditPostCandidate } from '../../actions/meme/reddit-post-client.js';
import { dispatchMemeMedia } from '../../actions/meme/telegram-dispatcher.js';
import { downloadTiktokWithYtDlp } from '../../actions/meme/tiktok-client.js';
import type { MemePostCandidate } from '../../actions/meme/types.js';
import {
  isDirectVideoTooLargeError,
  isDirectVideoTooLongError
} from '../../actions/meme/video-pipeline.js';
import { downloadYoutubeShortWithYtDlp } from '../../actions/meme/youtube-short-client.js';
import { downloadRedditVideoWithYtDlp } from '../../actions/meme/yt-dlp-client.js';
import { runWithProcessStatus } from '../../process-status.js';
import {
  assertInstagramSourceAvailable,
  InstagramSourceLockedError,
  isInstagramSourceLockError,
  markInstagramSourceBlocked
} from '../../source-locks/instagram-source-lock.js';
import {
  appendDirectMediaAuthor,
  formatDirectMediaAuthor
} from '../direct-media-author.js';
import type { DirectMediaLinkKind } from '../direct-media-link.js';
import { dispatchTextReply } from '../outbound-voice.js';
import {
  type MemeJobInput,
  sendCandidate,
  sendDownloadedCandidate
} from './send.js';
import { runQueuedVideoJob } from './video-job.js';

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

  if (input.kind === 'tiktok') {
    return runDirectTiktokMemeJob(input);
  }

  return runDirectInstagramReelMemeJob(input);
}

async function runDirectTiktokMemeJob(
  input: MemeJobInput & { text: string }
): Promise<boolean> {
  try {
    const sentVideo = await runQueuedVideoJob({
      job: input,
      source: 'tiktok',
      run: async () => {
        const video = await runWithProcessStatus(
          input.deps,
          {
            chatId: input.request.chatId,
            status: { preset: 'video_pipeline' }
          },
          (status) =>
            downloadTiktokWithYtDlp({
              text: input.text,
              maxBytes: memeActionConfig.telegramMedia.videoMaxBytes,
              processStatus: status,
              ...(input.deps.execFile ? { execFile: input.deps.execFile } : {})
            })
        );
        if (!video) return false;

        try {
          const sent = await runWithProcessStatus(
            input.deps,
            {
              chatId: input.request.chatId,
              status: { preset: 'video_pipeline', startStage: 'upload' }
            },
            async (status) => {
              await status.stage('upload');

              return dispatchMemeMedia({
                memeDispatcher: input.deps.memeDispatcher,
                chatId: input.request.chatId,
                replyToMessageId: null,
                reply: false,
                caption: getDirectMediaCaption(input, video.caption),
                media: video.downloaded
              });
            }
          );

          input.deps.db.saveBotMessage({
            chatId: input.request.chatId,
            chatType: input.request.chatType,
            chatTitle: input.request.chatTitle,
            messageId: sent.messageId,
            text: getDirectMediaCaption(input, video.caption),
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
          if (await handleDirectVideoFailure(input, error)) return true;

          input.logger.warn('tiktok_dispatch_failed', serializeError(error));
          return true;
        } finally {
          await video.downloaded.cleanup();
        }

        await deleteSourceMessage(input);
        return true;
      }
    });
    if (!sentVideo) return false;
  } catch (error) {
    if (await handleDirectVideoFailure(input, error)) return true;

    input.logger.warn('tiktok_ytdlp_failed', serializeError(error));
    return false;
  }

  return true;
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
      const sentFallback = await runQueuedVideoJob({
        job: input,
        source: 'reddit',
        run: () =>
          runWithProcessStatus(
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
                ...(input.deps.execFile
                  ? { execFile: input.deps.execFile }
                  : {})
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
                  reply: false,
                  ...getDirectMediaCaptionOptions(input)
                }
              );

              return true;
            }
          )
      });
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
    await sendCandidate(input, candidate, {
      reply: false,
      ...getDirectMediaCaptionOptions(input)
    });
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
  try {
    const sentShort = await runQueuedVideoJob({
      job: input,
      source: 'youtube',
      run: async () => {
        const short = await runWithProcessStatus(
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
                caption: getDirectMediaCaption(input, short.caption),
                media: short.downloaded
              });
            }
          );

          input.deps.db.saveBotMessage({
            chatId: input.request.chatId,
            chatType: input.request.chatType,
            chatTitle: input.request.chatTitle,
            messageId: sent.messageId,
            text: getDirectMediaCaption(input, short.caption),
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

          input.logger.warn(
            'youtube_short_dispatch_failed',
            serializeError(error)
          );
          return true;
        } finally {
          await short.downloaded.cleanup();
        }

        await deleteSourceMessage(input);
        return true;
      }
    });
    if (!sentShort) return false;
  } catch (error) {
    if (await handleDirectVideoFailure(input, error)) {
      return true;
    }

    input.logger.warn('youtube_short_ytdlp_failed', serializeError(error));
    return false;
  }

  return true;
}

async function runDirectInstagramReelMemeJob(
  input: MemeJobInput & { text: string }
): Promise<boolean> {
  try {
    const sentReel = await runQueuedVideoJob({
      job: input,
      source: 'instagram',
      beforeRun: async () => {
        await assertInstagramSourceAvailable({
          db: input.deps.db,
          cookiesPath: input.deps.env.instagramCookiesPath,
          now: input.deps.now(),
          logger: input.logger
        });
      },
      run: async () => {
        const reel = await runWithProcessStatus(
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
                caption: getDirectMediaCaption(input, reel.caption),
                media: reel.downloaded
              });
            }
          );

          input.deps.db.saveBotMessage({
            chatId: input.request.chatId,
            chatType: input.request.chatType,
            chatTitle: input.request.chatTitle,
            messageId: sent.messageId,
            text: getDirectMediaCaption(input, reel.caption),
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

          input.logger.warn(
            'instagram_reel_dispatch_failed',
            serializeError(error)
          );
          return true;
        } finally {
          await reel.downloaded.cleanup();
        }

        await deleteSourceMessage(input);
        return true;
      }
    });
    if (!sentReel) return false;
  } catch (error) {
    if (isInstagramSourceLockError(error)) {
      await markInstagramSourceBlocked({
        db: input.deps.db,
        cookiesPath: input.deps.env.instagramCookiesPath,
        reason: 'auth_required',
        now: input.deps.now(),
        logger: input.logger
      });
    }

    const instagramErrorText = extractInstagramErrorText(error);
    if (instagramErrorText) {
      await dispatchTextReply({
        deps: input.deps,
        request: input.request,
        text: instagramErrorText
      });
      return true;
    }

    if (await handleDirectVideoFailure(input, error)) {
      return true;
    }

    input.logger.warn('instagram_reel_ytdlp_failed', serializeError(error));
    return false;
  }

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

  if (error instanceof InstagramSourceLockedError) {
    await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: text.meme.instagramUnavailableFallback
    });
    return true;
  }

  if (isInstagramSourceLockError(error)) {
    await dispatchTextReply({
      deps: input.deps,
      request: input.request,
      text: text.meme.instagramUnavailableFallback
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

function getDirectMediaCaption(input: MemeJobInput, caption: string): string {
  return appendDirectMediaAuthor(caption, {
    chatType: input.request.chatType,
    fromUserId: input.request.fromUserId ?? null,
    fromUsername: input.request.fromUsername ?? null,
    fromDisplayName: input.request.fromDisplayName
  });
}

function getDirectMediaCaptionOptions(input: MemeJobInput): {
  captionSuffix?: string;
} {
  if (
    input.request.chatType !== 'group' &&
    input.request.chatType !== 'supergroup'
  ) {
    return {};
  }

  return {
    captionSuffix: formatDirectMediaAuthor({
      chatType: input.request.chatType,
      fromUserId: input.request.fromUserId ?? null,
      fromUsername: input.request.fromUsername ?? null,
      fromDisplayName: input.request.fromDisplayName
    })
  };
}
