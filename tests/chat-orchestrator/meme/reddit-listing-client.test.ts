import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import { fetchRedditListingCandidates } from '../../../src/app/actions/meme/reddit-listing-client.js';

describe('fetchRedditListingCandidates', () => {
  test('fetches subreddit top-week listing and maps image and video candidates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            children: [
              redditChild({
                id: 'img1',
                subreddit: 'SipsTea',
                title: 'image post',
                permalink: '/r/SipsTea/comments/img1/image_post/',
                ups: 123,
                url: 'https://i.redd.it/image-post.jpeg'
              }),
              redditChild({
                id: 'vid1',
                subreddit: 'SipsTea',
                title: 'video post',
                permalink: '/r/SipsTea/comments/vid1/video_post/',
                ups: 456,
                url: 'https://v.redd.it/video-post',
                secure_media: {
                  reddit_video: {
                    fallback_url:
                      'https://v.redd.it/video-post/DASH_720.mp4?source=fallback',
                    duration: 37
                  }
                }
              })
            ]
          }
        })
      )
    );

    const candidates = await fetchRedditListingCandidates({
      subreddit: 'SipsTea',
      count: 10,
      timeRange: 'week',
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.reddit.com/r/SipsTea/top/.json?t=week&limit=10',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          'User-Agent': 'test-chatbot/0.1 by /u/local-test'
        })
      })
    );
    expect(candidates).toEqual([
      {
        redditPostId: 'img1',
        subreddit: 'SipsTea',
        title: 'image post',
        permalink: 'https://www.reddit.com/r/SipsTea/comments/img1/image_post/',
        upvotes: 123,
        media: {
          kind: 'image',
          mediaUrl: 'https://i.redd.it/image-post.jpeg',
          extension: 'jpeg'
        }
      },
      {
        redditPostId: 'vid1',
        subreddit: 'SipsTea',
        title: 'video post',
        permalink: 'https://www.reddit.com/r/SipsTea/comments/vid1/video_post/',
        upvotes: 456,
        media: {
          kind: 'video',
          mediaUrl:
            'https://www.reddit.com/r/SipsTea/comments/vid1/video_post/',
          extension: 'mp4',
          durationSeconds: 37,
          downloadStrategy: 'yt-dlp'
        }
      }
    ]);
  });

  test('skips NSFW, spoiler and unsupported external posts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            children: [
              redditChild({
                id: 'nsfw',
                over_18: true,
                url: 'https://i.redd.it/nsfw.jpeg'
              }),
              redditChild({
                id: 'spoiler',
                spoiler: true,
                url: 'https://i.redd.it/spoiler.jpeg'
              }),
              redditChild({
                id: 'external',
                url: 'https://example.com/post'
              }),
              redditChild({
                id: 'ok',
                url: 'https://i.redd.it/ok.png'
              })
            ]
          }
        })
      )
    );

    const candidates = await fetchRedditListingCandidates({
      subreddit: 'memes',
      count: 10,
      timeRange: 'week',
      fetch: fetchMock
    });

    expect(candidates.map((candidate) => candidate.redditPostId)).toEqual([
      'ok'
    ]);
  });

  test('returns an empty list for private or missing subreddit listings', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('blocked', { status: 403 }));

    await expect(
      fetchRedditListingCandidates({
        subreddit: 'private',
        count: 10,
        timeRange: 'week',
        fetch: fetchMock
      })
    ).resolves.toEqual([]);
  });

  test('sends Reddit cookies from the SQLite data directory', async () => {
    const tempDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'reddit-cookies-test-')
    );
    await writeFile(
      path.join(tempDirectory, 'reddit-cookies.txt'),
      [
        '# Netscape HTTP Cookie File',
        '.reddit.com\tTRUE\t/\tTRUE\t2147483647\tsession\tabc123',
        'reddit.com\tFALSE\t/\tTRUE\t2147483647\tcsv\t2'
      ].join('\n')
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { children: [] }
        })
      )
    );

    await fetchRedditListingCandidates({
      subreddit: 'SipsTea',
      count: 10,
      timeRange: 'week',
      sqlitePath: path.join(tempDirectory, 'bot.sqlite'),
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.reddit.com/r/SipsTea/top/.json?t=week&limit=10',
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'session=abc123; csv=2'
        })
      })
    );
  });
});

function redditChild(data: Record<string, unknown>) {
  return {
    kind: 't3',
    data: {
      subreddit: 'memes',
      title: 'post title',
      permalink: `/r/memes/comments/${String(data.id ?? 'post')}/post_title/`,
      ups: 10,
      over_18: false,
      spoiler: false,
      ...data
    }
  };
}
