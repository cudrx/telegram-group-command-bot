import { describe, expect, test } from 'vitest';

import { selectNewsPostsForDigest } from '../../../src/app/actions/news/source-policy.js';
import type {
  NewsPost,
  NewsSourceConfig
} from '../../../src/app/actions/news/types.js';

const sources: NewsSourceConfig[] = [
  {
    slug: 'rare',
    handle: '@rare',
    label: 'Rare',
    role: 'rare-high-signal',
    importance: 'high',
    lookbackDays: 7,
    maxPostsPerDigest: 10,
    promptNote: 'rare note'
  },
  {
    slug: 'context',
    handle: '@context',
    label: 'Context',
    role: 'context',
    importance: 'normal',
    lookbackDays: 1,
    maxPostsPerDigest: 3,
    promptNote: 'context note'
  }
];

const posts: NewsPost[] = [
  post('rare', 1, '2026-05-13T12:00:00.000Z'),
  post('rare', 2, '2026-05-19T12:00:00.000Z'),
  post('context', 10, '2026-05-20T08:00:00.000Z'),
  post('context', 11, '2026-05-20T09:00:00.000Z'),
  post('context', 12, '2026-05-20T10:00:00.000Z')
];

describe('selectNewsPostsForDigest', () => {
  test('keeps rare high-signal posts in the lookback window', () => {
    const selected = selectNewsPostsForDigest({
      sources,
      posts,
      now: '2026-05-20T12:00:00.000Z'
    });

    expect(
      selected.bySource.get('rare')?.map((item) => item.messageId)
    ).toEqual([1, 2]);
  });

  test('limits context sources without excluding previously selected posts', () => {
    const selected = selectNewsPostsForDigest({
      sources,
      posts,
      now: '2026-05-20T12:00:00.000Z'
    });

    expect(
      selected.bySource.get('context')?.map((item) => item.messageId)
    ).toEqual([10, 11, 12]);
  });
});

function post(
  sourceSlug: string,
  messageId: number,
  publishedAt: string
): NewsPost {
  return {
    sourceSlug,
    messageId,
    publishedAt,
    fetchedAt: '2026-05-20T12:00:00.000Z',
    text: `post ${messageId}`,
    url: `https://t.me/${sourceSlug}/${messageId}`,
    contentHash: `hash-${messageId}`
  };
}
