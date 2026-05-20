import { loadPrompt } from '../../../llm/prompt-files.js';
import { renderPromptTemplate } from '../../../llm/prompts/render.js';
import type { NewsPost, NewsSourceConfig } from './types.js';

export function renderNewsSourcesPolicy(
  sources: readonly NewsSourceConfig[]
): string {
  return sources
    .map(
      (source) =>
        `- ${source.handle}: role=${source.role}, importance=${source.importance}, lookbackDays=${source.lookbackDays}, maxPostsPerDigest=${source.maxPostsPerDigest}. ${source.promptNote}`
    )
    .join('\n');
}

export function renderNewsPostsBySource(input: {
  sources: readonly NewsSourceConfig[];
  bySource: Map<string, NewsPost[]>;
}): string {
  const sections = input.sources.map((source) => {
    const posts = input.bySource.get(source.slug) ?? [];
    const renderedPosts =
      posts.length > 0
        ? posts.map((post) => renderNewsPost(post)).join('\n\n')
        : 'Нет постов, попавших в текущий отбор.';

    return [
      `Источник: ${source.handle} (${source.label})`,
      `Роль: ${source.role}`,
      '',
      renderedPosts
    ].join('\n');
  });

  return sections.join('\n\n---\n\n');
}

export function buildNewsAnalysisPrompt(input: {
  currentDateTime: string;
  analysisPeriod: string;
  sourcesPolicy: string;
  postsBySource: string;
}): string {
  return renderPromptTemplate(loadPrompt('newsAnalysis'), {
    current_datetime: input.currentDateTime,
    analysis_period: input.analysisPeriod,
    sources_policy: input.sourcesPolicy,
    posts_by_source: input.postsBySource
  });
}

function renderNewsPost(post: NewsPost): string {
  return [`[${formatUtcMinute(post.publishedAt)}] ${post.url}`, post.text].join(
    '\n'
  );
}

function formatUtcMinute(isoDate: string): string {
  return `${isoDate.slice(0, 10)} ${isoDate.slice(11, 16)} UTC`;
}
