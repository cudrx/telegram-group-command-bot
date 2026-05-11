import { describe, expect, test, vi } from 'vitest';

import { fetchTopRedditPosts } from '../../../src/app/chat-orchestrator/meme/reddit-client.js';

describe('fetchTopRedditPosts', () => {
  test('fetches subreddit top listing with expected URL and headers', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            children: [
              { data: { id: 'a', title: 'first' } },
              { data: { id: 'b', title: 'second' } }
            ]
          }
        }),
        { status: 200 }
      )
    );

    const posts = await fetchTopRedditPosts({
      listingUrlBase: 'https://www.reddit.com/r',
      subreddit: 'odd memes',
      timeRange: 'week',
      limit: 10,
      userAgent: 'test-chatbot/0.1',
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.reddit.com/r/odd%20memes/top.json?t=week&limit=10',
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'test-chatbot/0.1'
        }
      }
    );
    expect(posts).toEqual([
      { id: 'a', title: 'first' },
      { id: 'b', title: 'second' }
    ]);
  });

  test('filters listing children without object data', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            children: [
              { data: { id: 'keep', title: 'valid' } },
              { data: null },
              { data: 'not an object' },
              {},
              null
            ]
          }
        }),
        { status: 200 }
      )
    );

    const posts = await fetchTopRedditPosts({
      listingUrlBase: 'https://www.reddit.com/r',
      subreddit: 'memes',
      timeRange: 'week',
      limit: 10,
      userAgent: 'test-chatbot/0.1',
      fetch: fetchMock
    });

    expect(posts).toEqual([{ id: 'keep', title: 'valid' }]);
  });

  test('throws on non-2xx responses', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      new Response('too many requests', {
        status: 429,
        statusText: 'Too Many Requests'
      })
    );

    await expect(
      fetchTopRedditPosts({
        listingUrlBase: 'https://www.reddit.com/r',
        subreddit: 'memes',
        timeRange: 'week',
        limit: 10,
        userAgent: 'test-chatbot/0.1',
        fetch: fetchMock
      })
    ).rejects.toThrow('Reddit listing failed with status 429');
  });
});
