import { memeActionConfig } from '../../../config/runtime/index.js';
import { serializeError } from '../../../logging/logger.js';
import { downloadInstagramReelWithYtDlp } from '../../actions/meme/instagram-reel-client.js';
import { fetchRedditPostCandidate } from '../../actions/meme/reddit-post-client.js';
import { dispatchMemeMedia } from '../../actions/meme/telegram-dispatcher.js';
import type { MemePostCandidate } from '../../actions/meme/types.js';
import { downloadRedditVideoWithYtDlp } from '../../actions/meme/yt-dlp-client.js';
import type { DirectMediaLinkKind } from '../direct-media-link.js';
import { runWithChatAction } from '../helpers/reply.js';
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

  return runDirectInstagramReelMemeJob(input);
}

async function runDirectRedditVideoMemeJob(
  input: MemeJobInput & { text: string }
): Promise<boolean> {
  let candidate: MemePostCandidate | null;

  try {
    candidate = await fetchRedditPostCandidate({
      text: input.text,
      sqlitePath: input.deps.env.sqlitePath,
      redditCookiesPath: input.deps.env.redditCookiesPath,
      ...(input.deps.fetch ? { fetch: input.deps.fetch } : {})
    });
  } catch (error) {
    input.logger.warn('reddit_video_resolution_failed', serializeError(error));
    let fallback: Awaited<ReturnType<typeof downloadRedditVideoWithYtDlp>>;

    try {
      fallback = await runWithChatAction(
        input.deps,
        input.request.chatId,
        'upload_video',
        () =>
          downloadRedditVideoWithYtDlp({
            text: input.text,
            sqlitePath: input.deps.env.sqlitePath,
            redditCookiesPath: input.deps.env.redditCookiesPath,
            maxBytes: memeActionConfig.media.videoMaxBytes,
            ...(input.deps.fetch ? { fetch: input.deps.fetch } : {}),
            ...(input.deps.execFile ? { execFile: input.deps.execFile } : {})
          })
      );
    } catch (fallbackError) {
      input.logger.warn(
        'reddit_video_ytdlp_failed',
        serializeError(fallbackError)
      );
      return false;
    }

    if (!fallback) return false;

    await sendDownloadedCandidate(
      input,
      fallback.candidate,
      fallback.downloaded,
      {
        reply: false
      }
    );

    await deleteSourceMessage(input);
    return true;
  }

  if (!candidate) return false;

  await sendCandidate(input, candidate, { reply: false });

  await deleteSourceMessage(input);
  return true;
}

async function runDirectInstagramReelMemeJob(
  input: MemeJobInput & { text: string }
): Promise<boolean> {
  let reel: Awaited<ReturnType<typeof downloadInstagramReelWithYtDlp>>;

  try {
    reel = await runWithChatAction(
      input.deps,
      input.request.chatId,
      'upload_video',
      () =>
        downloadInstagramReelWithYtDlp({
          text: input.text,
          sqlitePath: input.deps.env.sqlitePath,
          instagramCookiesPath: input.deps.env.instagramCookiesPath,
          maxBytes: memeActionConfig.media.videoMaxBytes,
          captionMaxLength: memeActionConfig.caption.maxLength,
          ...(input.deps.execFile ? { execFile: input.deps.execFile } : {})
        })
    );
  } catch (error) {
    input.logger.warn('instagram_reel_ytdlp_failed', serializeError(error));
    return false;
  }

  if (!reel) return false;

  try {
    const sent = await dispatchMemeMedia({
      memeDispatcher: input.deps.memeDispatcher,
      chatId: input.request.chatId,
      replyToMessageId: null,
      reply: false,
      caption: reel.caption,
      media: reel.downloaded
    });

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
