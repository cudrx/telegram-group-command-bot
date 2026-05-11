import { memeActionConfig } from '../../config/runtime/index.js';
import { serializeError } from '../../logging/logger.js';
import { runWithReplyTyping } from './helpers/reply.js';
import { formatMemeCaption } from './meme/caption.js';
import { getRecentlySentMemeIds } from './meme/history-store.js';
import { downloadMemeMediaToTemp } from './meme/media-downloader.js';
import { toMemePostCandidate } from './meme/media-resolver.js';
import { fetchTopRedditPosts } from './meme/reddit-client.js';
import { selectMemeSources } from './meme/source-selection.js';
import { dispatchMemeMedia } from './meme/telegram-dispatcher.js';
import type {
  DownloadedMemeMedia,
  MemePostCandidate,
  ResolvedMemeMedia
} from './meme/types.js';
import { toMemeMediaKind } from './meme/types.js';
import { assembleRedditVideo } from './meme/video-assembler.js';
import type { ChatOrchestratorDeps, ReplyRequest } from './types.js';

export async function runMemeJob(input: {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
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
  const posts = await fetchTopRedditPosts({
    subreddit: input.subreddit,
    limit: memeActionConfig.listing.limit,
    timeRange: memeActionConfig.listing.timeRange,
    listingUrlBase: memeActionConfig.reddit.listingUrlBase,
    userAgent: memeActionConfig.reddit.userAgent,
    ...(input.deps.fetch ? { fetch: input.deps.fetch } : {})
  });
  const candidates = posts
    .map(toMemePostCandidate)
    .filter((candidate): candidate is MemePostCandidate => Boolean(candidate));
  const seen = getRecentlySentMemeIds({
    db: input.deps.db,
    chatId: input.request.chatId,
    redditPostIds: candidates.map((candidate) => candidate.redditPostId),
    now: input.deps.now(),
    retentionDays: input.deps.env.memeHistoryRetentionDays
  });
  const fresh = candidates.filter(
    (candidate) => !seen.has(candidate.redditPostId)
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
    logger: ChatOrchestratorDeps['logger'];
  },
  candidate: MemePostCandidate
): Promise<void> {
  let downloaded: DownloadedMemeMedia | null = null;

  try {
    const captionResult = await input.deps.qwen.generateMemeCaption({
      title: candidate.title,
      subreddit: candidate.subreddit,
      upvotes: candidate.upvotes,
      permalink: candidate.permalink,
      mediaKind: candidate.media.kind
    });
    const caption = formatMemeCaption({
      localizedTitle: captionResult.text,
      subreddit: candidate.subreddit,
      upvotes: candidate.upvotes,
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
      outputMode: 'text'
    });
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
  if (media.kind === 'gallery') {
    return downloadGalleryMedia(deps, media);
  }

  const maxBytes =
    media.kind === 'image'
      ? memeActionConfig.media.imageMaxBytes
      : media.kind === 'video'
        ? memeActionConfig.media.videoMaxBytes
        : memeActionConfig.media.animationMaxBytes;
  const downloaded = await downloadMemeMediaToTemp({
    url: media.mediaUrl,
    filename: `reddit-meme.${media.extension}`,
    maxBytes,
    timeoutMs: memeActionConfig.media.downloadTimeoutMs,
    ...(deps.fetch ? { fetch: deps.fetch } : {})
  });

  if (media.kind === 'video') {
    const assembled = await assembleRedditVideo(downloaded);

    return { kind: 'video', extension: media.extension, ...assembled };
  }

  return { kind: media.kind, extension: media.extension, ...downloaded };
}

async function downloadGalleryMedia(
  deps: ChatOrchestratorDeps,
  media: Extract<ResolvedMemeMedia, { kind: 'gallery' }>
): Promise<DownloadedMemeMedia> {
  const files: Array<{ filePath: string; cleanup: () => Promise<void> }> = [];
  let totalBytes = 0;

  try {
    for (const [index, item] of media.items
      .slice(0, memeActionConfig.media.maxGalleryItems)
      .entries()) {
      const downloaded = await downloadMemeMediaToTemp({
        url: item.url,
        filename: `reddit-gallery-${index}.${item.extension}`,
        maxBytes: memeActionConfig.media.galleryItemMaxBytes,
        timeoutMs: memeActionConfig.media.downloadTimeoutMs,
        ...(deps.fetch ? { fetch: deps.fetch } : {})
      });

      files.push({
        filePath: downloaded.filePath,
        cleanup: downloaded.cleanup
      });
      totalBytes += downloaded.bytes;

      if (totalBytes > memeActionConfig.media.galleryTotalMaxBytes) {
        throw new Error(`Meme gallery is too large: ${totalBytes} bytes.`);
      }
    }
  } catch (error) {
    await Promise.all(files.map((file) => file.cleanup()));
    throw error;
  }

  return {
    kind: 'gallery',
    files,
    cleanup: async () => {
      await Promise.all(files.map((file) => file.cleanup()));
    }
  };
}

function getPrimaryMediaUrl(media: ResolvedMemeMedia): string | null {
  if (media.kind === 'gallery') {
    return media.items[0]?.url ?? null;
  }

  return media.mediaUrl;
}
