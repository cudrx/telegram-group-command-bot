import { describe, expect, test } from 'vitest';

import {
  buildNewsAnalysisPrompt,
  renderNewsPostsBySource,
  renderNewsSourcesPolicy
} from '../../../src/app/actions/news/render.js';
import type {
  NewsPost,
  NewsSourceConfig
} from '../../../src/app/actions/news/types.js';

const sources: NewsSourceConfig[] = [
  {
    slug: 'investblog_ru',
    handle: '@investblog_ru',
    label: 'InvestBlog',
    role: 'primary',
    importance: 'high',
    lookbackDays: 2,
    maxPostsPerDigest: 30,
    promptNote: 'Частый, но важный источник.'
  },
  {
    slug: 'thedailyblogteam',
    handle: '@thedailyblogteam',
    label: 'DailyBlog',
    role: 'context',
    importance: 'normal',
    lookbackDays: 1,
    maxPostsPerDigest: 20,
    promptNote: 'Новостной поток для фона.'
  }
];

describe('news prompt rendering', () => {
  test('renders source policy from runtime config', () => {
    expect(renderNewsSourcesPolicy(sources)).toContain(
      '@thedailyblogteam: role=context, importance=normal, lookbackDays=1, maxPostsPerDigest=20. Новостной поток для фона.'
    );
  });

  test('renders posts grouped by source with links and timestamps', () => {
    const rendered = renderNewsPostsBySource({
      sources,
      bySource: new Map([
        [
          'investblog_ru',
          [
            post({
              sourceSlug: 'investblog_ru',
              messageId: 100,
              publishedAt: '2026-05-20T09:00:00.000Z',
              text: 'Рынок и санкции'
            })
          ]
        ]
      ])
    });

    expect(rendered).toContain('Источник: @investblog_ru (InvestBlog)');
    expect(rendered).toContain(
      '[2026-05-20 09:00 UTC] https://t.me/investblog_ru/100'
    );
    expect(rendered).toContain('Рынок и санкции');
  });

  test('builds final LLM prompt with policy, period and posts variables', () => {
    const prompt = buildNewsAnalysisPrompt({
      currentDateTime: '2026-05-20 12:00 Europe/Moscow',
      analysisPeriod: '2026-05-19 — 2026-05-20',
      sourcesPolicy: renderNewsSourcesPolicy(sources),
      postsBySource: 'Источник: @investblog_ru\nНовость'
    });

    expect(prompt).toContain('2026-05-20 12:00 Europe/Moscow');
    expect(prompt).toContain('2026-05-19 — 2026-05-20');
    expect(prompt).toContain('@investblog_ru: role=primary');
    expect(prompt).toContain('Источник: @investblog_ru\nНовость');
    expect(prompt).toContain('Целевой объём отчёта: 3500–5000 знаков');
    expect(prompt).toContain('Верхний предел 6000 знаков');
    expect(prompt).toContain('оставь 3 сигнала');
    expect(prompt).toContain('Эффект: РФ +/−/0; граждане +/−/0; война +/−/0');
    expect(prompt).toContain(
      'context-источников не используй как самостоятельную основу'
    );
    expect(prompt).toContain('Бытовой digital-шум');
    expect(prompt).toContain(
      'Не называй рыночное движение доказательством инсайда'
    );
    expect(prompt).toContain('Финальный блок “Итог” — строго 5 строк');
    expect(prompt).not.toContain('{{sources_policy}}');
  });
});

function post(input: {
  sourceSlug: string;
  messageId: number;
  publishedAt: string;
  text: string;
}): NewsPost {
  return {
    ...input,
    fetchedAt: '2026-05-20T10:00:00.000Z',
    url: `https://t.me/${input.sourceSlug}/${input.messageId}`,
    contentHash: 'hash'
  };
}
