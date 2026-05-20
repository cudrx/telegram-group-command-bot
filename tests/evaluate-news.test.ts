import { describe, expect, test } from 'vitest';

import { buildNewsEvalPrompt } from '../scripts/evaluate-news.js';
import type { NewsPost } from '../src/app/actions/news/types.js';

describe('evaluate-news helpers', () => {
  test('builds an eval prompt from configured sources without unresolved variables', () => {
    const result = buildNewsEvalPrompt({
      now: '2026-05-20T12:00:00.000Z',
      posts: [
        post('investblog_ru', 10, '2026-05-20T08:00:00.000Z'),
        post('thedailyblogteam', 20, '2026-05-20T09:00:00.000Z')
      ]
    });

    expect(result.selectedCount).toBe(2);
    expect(result.sourceCounts).toMatchObject({
      investblog_ru: 1,
      thedailyblogteam: 1
    });
    expect(result.prompt).toContain('@investblog_ru: role=primary');
    expect(result.prompt).toContain('@thedailyblogteam: role=context');
    expect(result.prompt).toContain('eval post 10');
    expect(result.prompt).not.toContain('{{');
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
    text: `eval post ${messageId}`,
    url: `https://t.me/${sourceSlug}/${messageId}`,
    contentHash: `hash-${messageId}`
  };
}
