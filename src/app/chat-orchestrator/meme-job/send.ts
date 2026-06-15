import { memeActionConfig } from '../../../config/runtime/index.js';
import { formatMemeCaption } from '../../actions/meme/caption.js';
import type { RedditListingTimeRange } from '../../actions/meme/reddit-listing-client.js';
import { dispatchMemeMedia } from '../../actions/meme/telegram-dispatcher.js';
import type {
  DownloadedMemeMedia,
  MemePostCandidate,
  ResolvedMemeMedia
} from '../../actions/meme/types.js';
import { toMemeMediaKind } from '../../actions/meme/types.js';
import { runWithProcessStatus } from '../../process-status.js';
import type { ChatOrchestratorMediaSupport } from '../media/index.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';
import { downloadResolvedMedia, getMemeChatAction } from './download.js';
import { runQueuedVideoJob } from './video-job.js';

export type MemeListingJobConfig = {
  subreddits: readonly string[];
  listing: {
    limit: number;
    maxSourceAttempts: number;
    minUpvotes: number;
    timeRange: RedditListingTimeRange;
  };
  fallbackText: string;
  historyRetentionDays: number;
  telegramMedia: {
    imageMaxBytes: number;
    videoMaxBytes: number;
    videoMaxDurationSeconds: number;
    downloadTimeoutMs: number;
    metadataTimeoutMs: number;
    videoDownloadTimeoutMs: number;
    probeTimeoutMs: number;
    normalizeTimeoutMs: number;
  };
  videoQueue: {
    maxConcurrentJobs: number;
    maxConcurrentJobsPerChat: number;
  };
  caption: {
    maxLength: number;
  };
};

export type MemeJobInput = {
  deps: ChatOrchestratorDeps;
  request: ReplyRequest;
  mediaSupport?: ChatOrchestratorMediaSupport;
  logger: ChatOrchestratorDeps['logger'];
  config?: MemeListingJobConfig;
};

export async function sendCandidate(
  input: MemeJobInput,
  candidate: MemePostCandidate,
  options: { reply?: boolean } = {}
): Promise<void> {
  const runCandidate = async () => {
    const processStatusOptions = {
      chatId: input.request.chatId,
      replyToMessageId:
        (options.reply ?? true) !== false
          ? input.request.triggerMessageId
          : null,
      action: getMemeChatAction(candidate.media),
      ...(options.reply !== undefined ? { reply: options.reply } : {}),
      ...(candidate.media.kind === 'video'
        ? {
            status: {
              preset: 'video_pipeline'
            } as const
          }
        : {
            status: {
              preset: getMemeSearchStatusPreset(input),
              startStage: 'download'
            } as const
          })
    };

    await runWithProcessStatus(
      input.deps,
      processStatusOptions,
      async (status) => {
        const downloaded = await downloadResolvedMedia(
          input.deps,
          candidate.media,
          status
        );
        await status.stage('upload');

        await sendDownloadedCandidate(input, candidate, downloaded, options);
      }
    );
  };

  if (candidate.media.kind !== 'video') {
    await runCandidate();
    return;
  }

  await runQueuedVideoJob({
    job: input,
    source: 'reddit',
    run: runCandidate
  });
}

export async function sendDownloadedCandidate(
  input: MemeJobInput,
  candidate: MemePostCandidate,
  downloaded: DownloadedMemeMedia,
  options: { reply?: boolean } = {}
): Promise<void> {
  try {
    const reply = options.reply ?? true;
    const replyToMessageId = reply ? input.request.triggerMessageId : null;
    const shouldForceSpoiler = input.request.intent === 'sex';
    const media = shouldForceSpoiler
      ? forceSpoilerOnDownloadedMedia(downloaded)
      : downloaded;
    const caption = formatMemeCaption({
      title: candidate.title,
      subreddit: candidate.subreddit,
      upvotes: candidate.upvotes,
      permalink: candidate.permalink,
      maxLength: getMemeJobConfig(input).caption.maxLength
    });

    const sent = await dispatchMemeMedia({
      memeDispatcher: input.deps.memeDispatcher,
      chatId: input.request.chatId,
      replyToMessageId,
      reply,
      caption,
      ...(shouldForceSpoiler || candidate.media.hasSpoiler
        ? { hasSpoiler: true }
        : {}),
      media
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

export async function sendMemeFallback(
  input: Pick<MemeJobInput, 'deps' | 'request' | 'config'>
): Promise<void> {
  const fallbackText = getMemeJobConfig(input).fallbackText;
  const sent = await input.deps.replyDispatcher({
    chatId: input.request.chatId,
    replyToMessageId: input.request.triggerMessageId,
    text: fallbackText
  });

  input.deps.db.saveBotMessage({
    chatId: input.request.chatId,
    chatType: input.request.chatType,
    chatTitle: input.request.chatTitle,
    messageId: sent.messageId,
    text: fallbackText,
    createdAt: sent.createdAt,
    userId: input.deps.bot.userId,
    username: input.deps.bot.username,
    displayName: input.deps.bot.displayName,
    replyToMessageId: input.request.triggerMessageId,
    outputMode: 'text'
  });
}

export function getMemeJobConfig(
  input: Pick<MemeJobInput, 'config'>
): MemeListingJobConfig {
  return input.config ?? memeActionConfig;
}

function getPrimaryMediaUrl(media: ResolvedMemeMedia): string | null {
  if (media.kind === 'gallery') return null;

  return media.mediaUrl;
}

function getMemeSearchStatusPreset(
  input: MemeJobInput
): 'meme_search' | 'sex_search' {
  return input.request.intent === 'sex' ? 'sex_search' : 'meme_search';
}

function forceSpoilerOnDownloadedMedia(
  media: DownloadedMemeMedia
): DownloadedMemeMedia {
  if (media.kind !== 'gallery') {
    return media;
  }

  return {
    ...media,
    items: media.items.map((item) => ({
      ...item,
      hasSpoiler: true
    }))
  };
}
