import { serializeError } from '../../../logging/logger.js';
import { getRecentlySentMemeIds } from '../../actions/meme/history-store.js';
import { fetchRedditListingCandidates } from '../../actions/meme/reddit-listing-client.js';
import { selectMemeSources } from '../../actions/meme/source-selection.js';
import type { MemePostCandidate } from '../../actions/meme/types.js';
import { runWithProcessStatus } from '../../process-status.js';
import { getTelegramRetryAfterSeconds } from '../../telegram-rate-limit.js';
import {
  getMemeJobConfig,
  type MemeJobInput,
  sendCandidate,
  sendMemeFallback,
  sendMemeFloodWaitFallback
} from './send.js';

export async function runMemeJob(input: MemeJobInput): Promise<void> {
  const { deps, request, logger } = input;
  const activeFloodWaitSeconds =
    deps.memeFloodGate?.getRetryAfterSeconds(request.chatId) ?? null;

  if (activeFloodWaitSeconds !== null && activeFloodWaitSeconds > 0) {
    await sendFloodWaitNotice(input, activeFloodWaitSeconds);
    logger.debug('meme_job_rejected_flood_wait', {
      replyToMessageId: request.triggerMessageId,
      retryAfterSeconds: activeFloodWaitSeconds
    });
    return;
  }

  try {
    logger.debug('meme_job_started', {
      replyToMessageId: request.triggerMessageId
    });

    const sentMeme = await runWithProcessStatus(
      deps,
      {
        chatId: request.chatId,
        replyToMessageId: request.triggerMessageId
      },
      async () => selectAndSendMeme(input)
    );

    if (sentMeme) {
      logger.debug('meme_job_completed', {
        replyToMessageId: request.triggerMessageId
      });
      return;
    }

    await runWithProcessStatus(deps, { chatId: request.chatId }, async () => {
      await sendMemeFallback(input);
    });
    logger.debug('meme_job_fallback_sent', {
      replyToMessageId: request.triggerMessageId
    });
  } catch (error) {
    if (error instanceof MemeFloodWaitError) {
      return;
    }

    logger.error('meme_job_failed', serializeError(error));
  }
}

async function selectAndSendMeme(input: MemeJobInput): Promise<boolean> {
  const config = getMemeJobConfig(input);
  const sources = selectMemeSources({
    subreddits: config.subreddits,
    maxSourceAttempts: config.listing.maxSourceAttempts,
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
      if (error instanceof MemeFloodWaitError) {
        throw error;
      }

      input.logger.warn('meme_source_failed', {
        subreddit,
        ...serializeError(error)
      });
    }
  }

  return false;
}

async function selectAndSendFromSubreddit(
  input: MemeJobInput & { subreddit: string }
): Promise<boolean> {
  const config = getMemeJobConfig(input);
  const candidates = await fetchRedditListingCandidates({
    subreddit: input.subreddit,
    count: config.listing.limit,
    timeRange: config.listing.timeRange,
    redditCookieHeaderPath: input.deps.env.redditCookieHeaderPath,
    sqlitePath: input.deps.env.sqlitePath,
    redditCookiesPath: input.deps.env.redditCookiesPath,
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
      candidate.upvotes >= config.listing.minUpvotes &&
      !seen.has(candidate.redditPostId)
  );

  for (const candidate of shuffleCandidates(fresh, input.deps.random)) {
    try {
      await sendCandidate(input, candidate, { reply: false });
      return true;
    } catch (error) {
      const retryAfterSeconds = getTelegramRetryAfterSeconds(error);
      if (retryAfterSeconds !== null) {
        input.deps.memeFloodGate?.block(
          input.request.chatId,
          retryAfterSeconds
        );
        input.logger.warn('meme_job_rate_limited', {
          subreddit: candidate.subreddit,
          redditPostId: candidate.redditPostId,
          permalink: candidate.permalink,
          mediaKind: candidate.media.kind,
          retryAfterSeconds,
          ...serializeError(error)
        });
        await sendFloodWaitNotice(input, retryAfterSeconds);
        throw new MemeFloodWaitError(retryAfterSeconds);
      }

      input.logger.warn('meme_candidate_failed', {
        subreddit: candidate.subreddit,
        redditPostId: candidate.redditPostId,
        permalink: candidate.permalink,
        mediaKind: candidate.media.kind,
        ...serializeError(error)
      });
    }
  }

  return false;
}

class MemeFloodWaitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Telegram flood wait active for ${retryAfterSeconds} seconds.`);
    this.name = 'MemeFloodWaitError';
  }
}

async function sendFloodWaitNotice(
  input: MemeJobInput,
  retryAfterSeconds: number
): Promise<void> {
  try {
    await sendMemeFloodWaitFallback(input, retryAfterSeconds);
  } catch (error) {
    input.logger.warn('meme_flood_wait_notice_failed', serializeError(error));
  }
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
