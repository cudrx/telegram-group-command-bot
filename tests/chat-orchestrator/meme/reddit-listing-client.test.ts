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

  test('marks NSFW and spoiler posts as Telegram spoilers and skips unsupported external posts', async () => {
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

    expect(candidates).toEqual([
      expect.objectContaining({
        redditPostId: 'nsfw',
        media: expect.objectContaining({ hasSpoiler: true })
      }),
      expect.objectContaining({
        redditPostId: 'spoiler',
        media: expect.objectContaining({ hasSpoiler: true })
      }),
      expect.objectContaining({
        redditPostId: 'ok',
        media: expect.not.objectContaining({ hasSpoiler: true })
      })
    ]);
  });

  test('maps gallery candidates and skips self text posts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            children: [
              redditChild({
                id: 'gallery',
                title: 'gallery post',
                is_gallery: true,
                gallery_data: {
                  items: [{ media_id: 'a1' }, { media_id: 'b2' }]
                },
                media_metadata: {
                  a1: {
                    status: 'valid',
                    m: 'image/jpg',
                    s: {
                      u: 'https://preview.redd.it/a1.jpg?width=640&amp;format=pjpg'
                    }
                  },
                  b2: {
                    status: 'valid',
                    m: 'image/webp',
                    s: {
                      u: 'https://preview.redd.it/b2.webp?width=640&amp;format=webp'
                    }
                  }
                }
              }),
              redditChild({
                id: 'self',
                is_self: true,
                selftext: 'text post',
                url: 'https://www.reddit.com/r/memes/comments/self/text/'
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

    expect(candidates).toEqual([
      expect.objectContaining({
        redditPostId: 'gallery',
        media: {
          kind: 'gallery',
          items: [
            {
              mediaUrl: 'https://preview.redd.it/a1.jpg?width=640&format=pjpg',
              extension: 'jpg'
            },
            {
              mediaUrl: 'https://preview.redd.it/b2.webp?width=640&format=webp',
              extension: 'webp'
            }
          ]
        }
      })
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

  test('sends Reddit cookies from an explicit cookies path', async () => {
    const tempDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'reddit-explicit-cookies-test-')
    );
    const cookiesPath = path.join(tempDirectory, 'custom-reddit-cookies.txt');
    await writeFile(
      cookiesPath,
      '.reddit.com\tTRUE\t/\tTRUE\t2147483647\tsession\texplicit'
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
      redditCookiesPath: cookiesPath,
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.reddit.com/r/SipsTea/top/.json?t=week&limit=10',
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'session=explicit'
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
