import { memeActionConfig } from '../../config/runtime/index.js';
import { serializeError } from '../../logging/logger.js';
import { formatMemeCaption } from '../actions/meme/caption.js';
import { getRecentlySentMemeIds } from '../actions/meme/history-store.js';
import { downloadMemeMediaToTemp } from '../actions/meme/media-downloader.js';
import { fetchMemeApiCandidates } from '../actions/meme/meme-api-client.js';
import { fetchRedditVideoCandidate } from '../actions/meme/reddit-post-client.js';
import { selectMemeSources } from '../actions/meme/source-selection.js';
import { dispatchMemeMedia } from '../actions/meme/telegram-dispatcher.js';
import type {
  DownloadedMemeMedia,
  MemePostCandidate,
  ResolvedMemeMedia
} from '../actions/meme/types.js';
import { toMemeMediaKind } from '../actions/meme/types.js';
import { runWithReplyTyping } from './helpers/reply.js';
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
      ...(input.deps.fetch ? { fetch: input.deps.fetch } : {})
    });
  } catch (error) {
    input.logger.warn('reddit_video_resolution_failed', serializeError(error));
    return false;
  }

  if (!candidate) return false;

  await runWithReplyTyping(input.deps, input.request.chatId, async () => {
    await sendCandidate(input, candidate);
  });

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

  return true;
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

    const sentMeme = await runWithReplyTyping(deps, request.chatId, async () =>
      selectAndSendMeme({ deps, request, logger })
    );

    if (sentMeme) {
      logger.debug('meme_job_completed', {
        replyToMessageId: request.triggerMessageId
      });
      return;
    }

    await sendMemeFallback({ deps, request });
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
      const candidate = await selectCandidateFromSubreddit({
        deps: input.deps,
        request: input.request,
        subreddit
      });

      if (!candidate) {
        continue;
      }

      await sendCandidate(input, candidate);
      return true;
    } catch (error) {
      input.logger.warn('meme_source_failed', {
        subreddit,
        ...serializeError(error)
      });
    }
  }

  return false;
}

async function selectCandidateFromSubreddit(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  subreddit: string;
}): Promise<MemePostCandidate | null> {
  const candidates = await fetchMemeApiCandidates({
    subreddit: input.subreddit,
    count: memeActionConfig.listing.limit,
    baseUrl: memeActionConfig.source.baseUrl,
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

  if (fresh.length === 0) return null;

  return (
    fresh[Math.floor(input.deps.random() * fresh.length)] ?? fresh[0] ?? null
  );
}

async function sendCandidate(
  input: {
    deps: ChatOrchestratorDeps;
    request: ReplyRequest;
    mediaSupport?: ChatOrchestratorMediaSupport;
    logger: ChatOrchestratorDeps['logger'];
  },
  candidate: MemePostCandidate
): Promise<void> {
  let downloaded: DownloadedMemeMedia | null = null;

  try {
    const caption = formatMemeCaption({
      title: candidate.title,
      subreddit: candidate.subreddit,
      upvotes: candidate.upvotes,
      permalink: candidate.permalink,
      maxLength: memeActionConfig.caption.maxLength
    });

    downloaded = await downloadResolvedMedia(input.deps, candidate.media);

    const sent = await dispatchMemeMedia({
      memeDispatcher: input.deps.memeDispatcher,
      chatId: input.request.chatId,
      replyToMessageId: input.request.triggerMessageId,
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
      replyToMessageId: input.request.triggerMessageId,
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
    await downloaded?.cleanup();
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
