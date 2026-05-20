import { describe, expect, test } from 'vitest';

import { newsActionConfig } from '../../../src/config/runtime/index.js';

describe('newsActionConfig', () => {
  test('keeps noisy source limits lower than primary and rare sources', () => {
    const limits = Object.fromEntries(
      newsActionConfig.sources.map((source) => [
        source.slug,
        source.maxPostsPerDigest
      ])
    );

    expect(limits).toMatchObject({
      investblog_ru: 20,
      auantonov: 7,
      crimsondigest: 7,
      thedailyblogteam: 8
    });
    expect(limits.thedailyblogteam).toBeLessThan(
      limits.investblog_ru ?? Number.POSITIVE_INFINITY
    );
  });
});
