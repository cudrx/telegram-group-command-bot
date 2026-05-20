import { newsActionConfig } from '../../../config/runtime/index.js';
import { dispatchTextReply } from '../../chat-orchestrator/outbound-voice.js';
import { formatTelegramHtmlReply } from '../../telegram-html.js';
import type { ChatAction } from '../types.js';
import {
  buildNewsAnalysisPrompt,
  renderNewsPostsBySource,
  renderNewsSourcesPolicy
} from './render.js';
import { fetchTelegramChannelPosts } from './scraper.js';
import { selectNewsPostsForDigest } from './source-policy.js';

export const newsAction: ChatAction = {
  intent: 'news',
  commands: ['news'],
  modes: ['private_admin'],
  async handle(ctx) {
    const now = ctx.deps.now();
    const fetcher = ctx.deps.fetch ?? globalThis.fetch;
    const sources = [...newsActionConfig.sources];
    const fetchedPosts = [];
    const failedSources: string[] = [];

    ctx.logger.debug('news_digest_started', {
      sourceCount: sources.length,
      triggerMessageId: ctx.request.triggerMessageId
    });

    for (const source of sources) {
      try {
        const sourcePosts = await fetchTelegramChannelPosts({
          fetch: fetcher,
          source,
          now,
          timeoutMs: newsActionConfig.fetchTimeoutMs,
          maxResponseChars: newsActionConfig.maxResponseChars,
          userAgent: newsActionConfig.userAgent
        });

        if (sourcePosts.length === 0) {
          failedSources.push(`${source.handle} (нет постов после парсинга)`);
          ctx.logger.warn('news_source_parse_empty', {
            sourceSlug: source.slug
          });
          continue;
        }

        fetchedPosts.push(...sourcePosts);
      } catch (error) {
        failedSources.push(`${source.handle} (fetch error)`);
        ctx.logger.warn('news_source_fetch_failed', {
          sourceSlug: source.slug,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (fetchedPosts.length > 0) {
      ctx.deps.db.saveNewsPosts(fetchedPosts);
    }

    const oldestCutoff = getOldestLookbackCutoff(sources, now);
    const cachedPosts = ctx.deps.db.getNewsPosts({
      sourceSlugs: sources.map((source) => source.slug),
      since: oldestCutoff
    });
    const selection = selectNewsPostsForDigest({
      sources,
      posts: cachedPosts,
      now
    });

    if (selection.selectedPosts.length === 0) {
      await dispatchLocalReply(
        ctx,
        formatUnavailableMessage(failedSources, 'Нет постов для анализа.')
      );
      return;
    }

    const prompt = buildNewsAnalysisPrompt({
      currentDateTime: now,
      analysisPeriod: selection.analysisPeriod,
      sourcesPolicy: renderNewsSourcesPolicy(sources),
      postsBySource: renderNewsPostsBySource({
        sources,
        bySource: selection.bySource
      })
    });
    const result = await ctx.deps.qwen.analyzeNews({ prompt });
    const prefix =
      failedSources.length > 0
        ? `WARN: не удалось получить данные по источникам: ${failedSources.join(', ')}.\n\n`
        : '';

    await dispatchLocalReply(ctx, `${prefix}${result.text}`);
  }
};

function getOldestLookbackCutoff(
  sources: Array<{ lookbackDays: number }>,
  now: string
): string {
  const maxLookbackDays = Math.max(
    ...sources.map((source) => source.lookbackDays)
  );

  return new Date(
    new Date(now).getTime() - maxLookbackDays * 24 * 60 * 60 * 1000
  ).toISOString();
}

async function dispatchLocalReply(
  ctx: Parameters<ChatAction['handle']>[0],
  text: string
): Promise<void> {
  await dispatchTextReply({
    deps: ctx.deps,
    request: ctx.request,
    text: formatTelegramHtmlReply(text)
  });
}

function formatUnavailableMessage(
  failedSources: string[],
  fallback: string
): string {
  if (failedSources.length === 0) return fallback;

  return `${fallback}\nWARN: не удалось получить данные по источникам: ${failedSources.join(', ')}.`;
}
