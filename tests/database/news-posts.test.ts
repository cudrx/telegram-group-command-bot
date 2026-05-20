import { describe, expect, test } from 'vitest';

import { DatabaseClient } from '../../src/database/index.js';
import { canUseBetterSqlite } from './support.js';

const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

describeWithSqlite('DatabaseClient news posts', () => {
  test('upserts news posts and reads them by source', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveNewsPosts([
      {
        sourceSlug: 'daily',
        messageId: 1,
        publishedAt: '2026-05-20T08:00:00.000Z',
        fetchedAt: '2026-05-20T09:00:00.000Z',
        text: 'old text',
        url: 'https://t.me/daily/1',
        contentHash: 'old'
      }
    ]);
    db.saveNewsPosts([
      {
        sourceSlug: 'daily',
        messageId: 1,
        publishedAt: '2026-05-20T08:00:00.000Z',
        fetchedAt: '2026-05-20T10:00:00.000Z',
        text: 'new text',
        url: 'https://t.me/daily/1',
        contentHash: 'new'
      }
    ]);

    expect(
      db.getNewsPosts({
        sourceSlugs: ['daily'],
        since: '2026-05-19T00:00:00.000Z'
      })
    ).toEqual([
      {
        sourceSlug: 'daily',
        messageId: 1,
        publishedAt: '2026-05-20T08:00:00.000Z',
        fetchedAt: '2026-05-20T10:00:00.000Z',
        text: 'new text',
        url: 'https://t.me/daily/1',
        contentHash: 'new'
      }
    ]);

    db.close();
  });

  test('cleanup deletes news posts older than retention', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveNewsPosts([
      {
        sourceSlug: 'daily',
        messageId: 1,
        publishedAt: '2026-05-10T00:00:00.000Z',
        fetchedAt: '2026-05-10T00:00:00.000Z',
        text: 'old',
        url: 'https://t.me/daily/1',
        contentHash: 'old'
      },
      {
        sourceSlug: 'daily',
        messageId: 2,
        publishedAt: '2026-05-19T00:00:00.000Z',
        fetchedAt: '2026-05-19T00:00:00.000Z',
        text: 'recent',
        url: 'https://t.me/daily/2',
        contentHash: 'recent'
      }
    ]);

    expect(
      db.cleanupExpiredData({
        now: '2026-05-20T00:00:00.000Z',
        messageRetentionDays: 30,
        mediaArtifactRetentionDays: 30,
        memeHistoryRetentionDays: 14,
        newsPostRetentionDays: 7
      })
    ).toMatchObject({ newsPosts: 1 });

    expect(
      db
        .getNewsPosts({
          sourceSlugs: ['daily'],
          since: '2026-05-01T00:00:00.000Z'
        })
        .map((item) => item.messageId)
    ).toEqual([2]);

    db.close();
  });
});
