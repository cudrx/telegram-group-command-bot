import { describe, expect, test } from 'vitest';

import { DatabaseClient } from '../../src/database/index.js';
import { canUseBetterSqlite } from './support.js';

const describeWithSqlite = canUseBetterSqlite() ? describe : describe.skip;

describeWithSqlite('DatabaseClient meme posts', () => {
  test('stores sent meme posts and finds recent ids for a chat', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveMemePost({
      chatId: 1,
      redditPostId: 'post-1',
      subreddit: 'Unexpected',
      telegramMessageId: 101,
      title: 'first meme',
      permalink: 'https://reddit.test/r/Unexpected/comments/post-1',
      mediaKind: 'image',
      mediaUrl: 'https://i.redd.it/post-1.jpg',
      upvotes: 100,
      sentAt: '2026-05-01T10:00:00.000Z'
    });
    db.saveMemePost({
      chatId: 1,
      redditPostId: 'post-2',
      subreddit: 'Unexpected',
      telegramMessageId: null,
      title: 'second meme',
      permalink: 'https://reddit.test/r/Unexpected/comments/post-2',
      mediaKind: 'image',
      mediaUrl: null,
      upvotes: 200,
      sentAt: '2026-05-05T10:00:00.000Z'
    });
    db.saveMemePost({
      chatId: 2,
      redditPostId: 'post-1',
      subreddit: 'Unexpected',
      telegramMessageId: 201,
      title: 'same post in another chat',
      permalink: 'https://reddit.test/r/Unexpected/comments/post-1',
      mediaKind: 'image',
      mediaUrl: 'https://i.redd.it/post-1.jpg',
      upvotes: 100,
      sentAt: '2026-05-05T10:00:00.000Z'
    });

    expect(
      db.getRecentMemePostIds({
        chatId: 1,
        redditPostIds: ['post-1', 'post-2', 'post-3'],
        since: '2026-05-03T00:00:00.000Z'
      })
    ).toEqual(new Set(['post-2']));

    expect(
      db.getRecentMemePostIds({
        chatId: 2,
        redditPostIds: ['post-1', 'post-2'],
        since: '2026-05-03T00:00:00.000Z'
      })
    ).toEqual(new Set(['post-1']));

    db.close();
  });

  test('updates an existing meme post for the same chat and reddit id', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveMemePost({
      chatId: 1,
      redditPostId: 'same-post',
      subreddit: 'Unexpected',
      telegramMessageId: 101,
      title: 'old title',
      permalink: 'https://reddit.test/r/Unexpected/comments/same-post',
      mediaKind: 'image',
      mediaUrl: 'https://i.redd.it/old.jpg',
      upvotes: 100,
      sentAt: '2026-05-01T10:00:00.000Z'
    });
    db.saveMemePost({
      chatId: 1,
      redditPostId: 'same-post',
      subreddit: 'Unexpected',
      telegramMessageId: 202,
      title: 'new title',
      permalink: 'https://reddit.test/r/Unexpected/comments/same-post-new',
      mediaKind: 'image',
      mediaUrl: 'https://i.redd.it/new.jpg',
      upvotes: 200,
      sentAt: '2026-05-10T10:00:00.000Z'
    });

    expect(
      db.getRecentMemePostIds({
        chatId: 1,
        redditPostIds: ['same-post'],
        since: '2026-05-05T00:00:00.000Z'
      })
    ).toEqual(new Set(['same-post']));

    db.close();
  });

  test('cleanup deletes meme posts older than retention', () => {
    const db = DatabaseClient.open(':memory:');

    db.saveMemePost({
      chatId: 1,
      redditPostId: 'old-post',
      subreddit: 'hmm',
      telegramMessageId: 10,
      title: 'old meme',
      permalink: 'https://reddit.test/r/hmm/comments/old-post',
      mediaKind: 'image',
      mediaUrl: 'https://i.redd.it/old-post.jpg',
      upvotes: 10,
      sentAt: '2026-04-10T00:00:00.000Z'
    });
    db.saveMemePost({
      chatId: 1,
      redditPostId: 'recent-post',
      subreddit: 'hmm',
      telegramMessageId: 11,
      title: 'recent meme',
      permalink: 'https://reddit.test/r/hmm/comments/recent-post',
      mediaKind: 'image',
      mediaUrl: 'https://i.redd.it/recent-post.jpg',
      upvotes: 20,
      sentAt: '2026-04-20T00:00:00.000Z'
    });

    expect(
      db.cleanupExpiredData({
        now: '2026-04-29T00:00:00.000Z',
        messageRetentionDays: 30,
        mediaArtifactRetentionDays: 30,
        memeHistoryRetentionDays: 14
      })
    ).toEqual({
      mediaArtifacts: 0,
      messages: 0,
      chats: 0,
      memePosts: 1
    });

    expect(
      db.getRecentMemePostIds({
        chatId: 1,
        redditPostIds: ['old-post', 'recent-post'],
        since: '2026-04-01T00:00:00.000Z'
      })
    ).toEqual(new Set(['recent-post']));

    db.close();
  });
});
