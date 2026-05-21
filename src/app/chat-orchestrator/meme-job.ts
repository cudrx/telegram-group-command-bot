import { memeActionConfig } from '../../config/runtime/index.js';
import { serializeError } from '../../logging/logger.js';
import { formatMemeCaption } from '../actions/meme/caption.js';
import { getRecentlySentMemeIds } from '../actions/meme/history-store.js';
import { downloadMemeMediaToTemp } from '../actions/meme/media-downloader.js';
import { fetchRedditListingCandidates } from '../actions/meme/reddit-listing-client.js';
import { fetchRedditVideoCandidate } from '../actions/meme/reddit-post-client.js';
import { selectMemeSources } from '../actions/meme/source-selection.js';
import { dispatchMemeMedia } from '../actions/meme/telegram-dispatcher.js';
import type {
  DownloadedMemeMedia,
  MemePostCandidate,
  ResolvedMemeMedia
} from '../actions/meme/types.js';
import { toMemeMediaKind } from '../actions/meme/types.js';
import { downloadRedditVideoWithYtDlp } from '../actions/meme/yt-dlp-client.js';
import { runWithChatAction, runWithReplyTyping } from './helpers/reply.js';
import type { ChatOrchestratorMediaSupport } from './media/index.js';
import type { ChatOrchestratorDeps, ReplyRequest } from './types.js';

export async function runDirectRedditVideoMemeJob(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  text: string;
  mediaSupport?: ChatOrchestratorMediaSupport;
  logger: ChatOrchestratorDeps['logger'];
}): Promise<boolean> {
  let candidate: MemePostCandidate | null;

  try {
    candidate = await fetchRedditVideoCandidate({
      text: input.text,
      sqlitePath: input.deps.env.sqlitePath,
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

async function deleteSourceMessage(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  logger: ChatOrchestratorDeps['logger'];
}): Promise<void> {
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

export async function runMemeJob(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  mediaSupport?: ChatOrchestratorMediaSupport;
  logger: ChatOrchestratorDeps['logger'];
}): Promise<void> {
  const { deps, request, logger } = input;

  try {
    logger.debug('meme_job_started', {
      replyToMessageId: request.triggerMessageId
    });

    const sentMeme = await selectAndSendMeme({ deps, request, logger });

    if (sentMeme) {
      logger.debug('meme_job_completed', {
        replyToMessageId: request.triggerMessageId
      });
      return;
    }

    await runWithReplyTyping(deps, request.chatId, async () => {
      await sendMemeFallback({ deps, request });
    });
    logger.debug('meme_job_fallback_sent', {
      replyToMessageId: request.triggerMessageId
    });
  } catch (error) {
    logger.error('meme_job_failed', serializeError(error));
  }
}

async function selectAndSendMeme(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  mediaSupport?: ChatOrchestratorMediaSupport;
  logger: ChatOrchestratorDeps['logger'];
}): Promise<boolean> {
  const sources = selectMemeSources({
    subreddits: memeActionConfig.subreddits,
    maxSourceAttempts: memeActionConfig.listing.maxSourceAttempts,
    random: input.deps.random
  });

  for (const subreddit of sources) {
    try {
      const sent = await selectAndSendFromSubreddit({
        deps: input.deps,
        request: input.request,
        logger: input.logger,
        subreddit
      });

      if (sent) return true;
    } catch (error) {
      input.logger.warn('meme_source_failed', {
        subreddit,
        ...serializeError(error)
      });
    }
  }

  return false;
}

async function selectAndSendFromSubreddit(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  logger: ChatOrchestratorDeps['logger'];
  subreddit: string;
}): Promise<boolean> {
  const candidates = await fetchRedditListingCandidates({
    subreddit: input.subreddit,
    count: memeActionConfig.listing.limit,
    timeRange: memeActionConfig.listing.timeRange,
    sqlitePath: input.deps.env.sqlitePath,
    ...(input.deps.fetch ? { fetch: input.deps.fetch } : {})
  });
  const seen = getRecentlySentMemeIds({
    db: input.deps.db,
    chatId: input.request.chatId,
    redditPostIds: candidates.map((candidate) => candidate.redditPostId),
    now: input.deps.now(),
    retentionDays: input.deps.env.memeHistoryRetentionDays
  });
  const fresh = candidates.filter(
    (candidate) =>
      candidate.upvotes >= memeActionConfig.listing.minUpvotes &&
      !seen.has(candidate.redditPostId)
  );

  for (const candidate of shuffleCandidates(fresh, input.deps.random)) {
    try {
      await sendCandidate(input, candidate, { reply: false });
      return true;
    } catch (error) {
      input.logger.warn('meme_candidate_failed', {
        subreddit: candidate.subreddit,
        redditPostId: candidate.redditPostId,
        mediaKind: candidate.media.kind,
        ...serializeError(error)
      });
    }
  }

  return false;
}

async function sendCandidate(
  input: {
    deps: ChatOrchestratorDeps;
    request: ReplyRequest;
    mediaSupport?: ChatOrchestratorMediaSupport;
    logger: ChatOrchestratorDeps['logger'];
  },
  candidate: MemePostCandidate,
  options: { reply?: boolean } = {}
): Promise<void> {
  await runWithChatAction(
    input.deps,
    input.request.chatId,
    getMemeChatAction(candidate.media),
    async () => {
      const downloaded = await downloadResolvedMedia(
        input.deps,
        candidate.media
      );

      await sendDownloadedCandidate(input, candidate, downloaded, options);
    }
  );
}

async function sendDownloadedCandidate(
  input: {
    deps: ChatOrchestratorDeps;
    request: ReplyRequest;
    mediaSupport?: ChatOrchestratorMediaSupport;
    logger: ChatOrchestratorDeps['logger'];
  },
  candidate: MemePostCandidate,
  downloaded: DownloadedMemeMedia,
  options: { reply?: boolean } = {}
): Promise<void> {
  try {
    const reply = options.reply ?? true;
    const replyToMessageId = reply ? input.request.triggerMessageId : null;
    const caption = formatMemeCaption({
      title: candidate.title,
      subreddit: candidate.subreddit,
      upvotes: candidate.upvotes,
      permalink: candidate.permalink,
      maxLength: memeActionConfig.caption.maxLength
    });

    const sent = await dispatchMemeMedia({
      memeDispatcher: input.deps.memeDispatcher,
      chatId: input.request.chatId,
      replyToMessageId,
      reply,
      caption,
      media: downloaded
    });
    input.deps.db.saveBotMessage({
      chatId: input.request.chatId,
      chatType: input.request.chatType,
      chatTitle: input.request.chatTitle,
      messageId: sent.messageId,
      text: caption,
      createdAt: sent.createdAt,
      userId: input.deps.bot.userId,
      username: input.deps.bot.username,
      displayName: input.deps.bot.displayName,
      replyToMessageId,
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

    input.deps.db.saveMemePost({
      chatId: input.request.chatId,
      redditPostId: candidate.redditPostId,
      subreddit: candidate.subreddit,
      telegramMessageId: sent.messageId,
      title: candidate.title,
      permalink: candidate.permalink,
      mediaKind: toMemeMediaKind(candidate.media),
      mediaUrl: getPrimaryMediaUrl(candidate.media),
      upvotes: candidate.upvotes,
      sentAt: sent.createdAt
    });
  } finally {
    await downloaded.cleanup();
  }
}

async function sendMemeFallback(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
}): Promise<void> {
  const sent = await input.deps.replyDispatcher({
    chatId: input.request.chatId,
    replyToMessageId: input.request.triggerMessageId,
    text: memeActionConfig.fallbackText
  });

  input.deps.db.saveBotMessage({
    chatId: input.request.chatId,
    chatType: input.request.chatType,
    chatTitle: input.request.chatTitle,
    messageId: sent.messageId,
    text: memeActionConfig.fallbackText,
    createdAt: sent.createdAt,
    userId: input.deps.bot.userId,
    username: input.deps.bot.username,
    displayName: input.deps.bot.displayName,
    replyToMessageId: input.request.triggerMessageId,
    outputMode: 'text'
  });
}

async function downloadResolvedMedia(
  deps: ChatOrchestratorDeps,
  media: ResolvedMemeMedia
): Promise<DownloadedMemeMedia> {
  if (media.kind === 'video' && media.downloadStrategy === 'yt-dlp') {
    const result = await downloadRedditVideoWithYtDlp({
      text: media.mediaUrl,
      sqlitePath: deps.env.sqlitePath,
      maxBytes: memeActionConfig.media.videoMaxBytes,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.execFile ? { execFile: deps.execFile } : {})
    });

    if (!result) {
      throw new Error(
        `yt-dlp could not resolve Reddit video: ${media.mediaUrl}`
      );
    }

    return result.downloaded;
  }

  const downloaded = await downloadMemeMediaToTemp({
    url: media.mediaUrl,
    filename: `meme-media.${media.extension}`,
    maxBytes:
      media.kind === 'video'
        ? memeActionConfig.media.videoMaxBytes
        : memeActionConfig.media.imageMaxBytes,
    timeoutMs: memeActionConfig.media.downloadTimeoutMs,
    ...(deps.fetch ? { fetch: deps.fetch } : {})
  });

  if (media.kind === 'video') {
    return {
      kind: 'video',
      extension: media.extension,
      durationSeconds: media.durationSeconds ?? null,
      ...downloaded
    };
  }

  return {
    kind: 'image',
    extension: media.extension,
    ...downloaded
  };
}

function getPrimaryMediaUrl(media: ResolvedMemeMedia): string | null {
  return media.mediaUrl;
}

function getMemeChatAction(
  media: ResolvedMemeMedia
): 'upload_photo' | 'upload_video' {
  return media.kind === 'video' ? 'upload_video' : 'upload_photo';
}

function shuffleCandidates(
  candidates: MemePostCandidate[],
  random: () => number
): MemePostCandidate[] {
  const shuffled = [...candidates];

  for (let index = 0; index < shuffled.length - 1; index += 1) {
    const remaining = shuffled.length - index;
    const swapIndex = index + Math.floor(random() * remaining);
    const current = shuffled[index];
    const target = shuffled[swapIndex];
    if (current === undefined || target === undefined) continue;

    shuffled[index] = target;
    shuffled[swapIndex] = current;
  }

  return shuffled;
}
