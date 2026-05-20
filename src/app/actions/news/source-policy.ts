import type { NewsPost, NewsSelection, NewsSourceConfig } from './types.js';

export function selectNewsPostsForDigest(input: {
  sources: readonly NewsSourceConfig[];
  posts: NewsPost[];
  now: string;
}): NewsSelection {
  const bySource = new Map<string, NewsPost[]>();
  const selectedPosts: NewsPost[] = [];

  for (const source of input.sources) {
    const cutoff = new Date(
      new Date(input.now).getTime() - source.lookbackDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const sourcePosts = input.posts
      .filter((post) => post.sourceSlug === source.slug)
      .filter((post) => post.publishedAt >= cutoff)
      .sort(compareByPublishedAtThenId)
      .slice(-source.maxPostsPerDigest);

    bySource.set(source.slug, sourcePosts);
    selectedPosts.push(...sourcePosts);
  }

  selectedPosts.sort(compareByPublishedAtThenId);

  return {
    bySource,
    selectedPosts,
    analysisPeriod: formatAnalysisPeriod(selectedPosts)
  };
}

function compareByPublishedAtThenId(left: NewsPost, right: NewsPost): number {
  const dateComparison = left.publishedAt.localeCompare(right.publishedAt);

  if (dateComparison !== 0) return dateComparison;

  return left.messageId - right.messageId;
}

function formatAnalysisPeriod(posts: NewsPost[]): string {
  if (posts.length === 0) return 'нет выбранных постов';

  const first = posts[0];
  const last = posts.at(-1);

  return `${first?.publishedAt ?? ''} — ${last?.publishedAt ?? ''}`;
}
