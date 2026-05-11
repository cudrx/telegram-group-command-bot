import { describe, expect, test, vi } from 'vitest';

import {
  createMemeApiSourceClient,
  fetchMemeApiCandidates
} from '../../../src/app/chat-orchestrator/meme/meme-api-client.js';

describe('fetchMemeApiCandidates', () => {
  test('maps meme-api image and gif responses to meme candidates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          count: 3,
          memes: [
            {
              postLink: 'https://redd.it/abc123',
              subreddit: 'shitposting',
              title: 'a title',
              url: 'https://i.redd.it/a.png',
              nsfw: false,
              spoiler: false,
              ups: 42
            },
            {
              postLink: 'https://redd.it/gif123',
              subreddit: 'shitposting',
              title: 'a gif',
              url: 'https://i.redd.it/b.gif',
              nsfw: false,
              spoiler: false,
              ups: 7
            },
            {
              postLink: 'https://redd.it/nsfw',
              subreddit: 'shitposting',
              title: 'skip',
              url: 'https://i.redd.it/c.png',
              nsfw: true,
              spoiler: false,
              ups: 1
            }
          ]
        })
      )
    );

    const candidates = await fetchMemeApiCandidates({
      subreddit: 'shitposting',
      count: 10,
      baseUrl: 'https://meme-api.com/gimme',
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://meme-api.com/gimme/shitposting/10',
      expect.objectContaining({
        headers: { Accept: 'application/json' }
      })
    );
    expect(candidates).toEqual([
      {
        redditPostId: 'abc123',
        subreddit: 'shitposting',
        title: 'a title',
        permalink: 'https://redd.it/abc123',
        upvotes: 42,
        media: {
          kind: 'image',
          mediaUrl: 'https://i.redd.it/a.png',
          extension: 'png'
        }
      },
      {
        redditPostId: 'gif123',
        subreddit: 'shitposting',
        title: 'a gif',
        permalink: 'https://redd.it/gif123',
        upvotes: 7,
        media: {
          kind: 'animation',
          mediaUrl: 'https://i.redd.it/b.gif',
          extension: 'gif'
        }
      }
    ]);
  });

  test('decodes URLs, maps direct images, reddit-hosted mp4s, and stable id fallbacks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          count: 3,
          memes: [
            {
              postLink:
                'https://www.reddit.com/r/memes/comments/full123/title/',
              subreddit: 'memes',
              title: 'full reddit link',
              url: 'https://cdn.example.com/a.webp?width=640&amp;foo=bar',
              nsfw: false,
              spoiler: false
            },
            {
              subreddit: 'memes',
              title: 'url fallback',
              url: 'https://i.redd.it/fallback.jpeg',
              nsfw: false,
              spoiler: false,
              ups: 12
            },
            {
              postLink: 'https://redd.it/mp4123',
              subreddit: 'memes',
              title: 'mp4',
              url: 'https://preview.redd.it/clip.mp4?format=mp4&amp;width=640',
              nsfw: false,
              spoiler: false,
              ups: 13
            }
          ]
        })
      )
    );

    const candidates = await fetchMemeApiCandidates({
      subreddit: 'memes',
      count: 3,
      fetch: fetchMock
    });

    expect(candidates).toMatchObject([
      {
        redditPostId: 'https://www.reddit.com/r/memes/comments/full123/title/',
        media: {
          kind: 'image',
          mediaUrl: 'https://cdn.example.com/a.webp?width=640&foo=bar',
          extension: 'webp'
        }
      },
      {
        redditPostId: 'https://i.redd.it/fallback.jpeg',
        upvotes: 12,
        media: {
          kind: 'image',
          mediaUrl: 'https://i.redd.it/fallback.jpeg',
          extension: 'jpeg'
        }
      },
      {
        redditPostId: 'mp4123',
        media: {
          kind: 'animation',
          mediaUrl: 'https://preview.redd.it/clip.mp4?format=mp4&width=640',
          extension: 'mp4'
        }
      }
    ]);
  });

  test('skips spoilers and unsupported media URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        count: 3,
        memes: [
          {
            postLink: 'https://redd.it/spoiler1',
            subreddit: 'memes',
            title: 'spoiler',
            url: 'https://i.redd.it/spoiler1.jpg',
            nsfw: false,
            spoiler: true
          },
          {
            postLink: 'https://redd.it/html1',
            subreddit: 'memes',
            title: 'html',
            url: 'https://example.com/html1',
            nsfw: false,
            spoiler: false
          },
          {
            postLink: 'https://redd.it/externalgif',
            subreddit: 'memes',
            title: 'external gif',
            url: 'https://cdn.example.com/externalgif.gif',
            nsfw: false,
            spoiler: false
          }
        ]
      })
    );

    await expect(
      fetchMemeApiCandidates({
        subreddit: 'memes',
        count: 3,
        fetch: fetchMock
      })
    ).resolves.toEqual([]);
  });

  test('treats meme-api image-empty 400 responses as no candidates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 400,
          message: 'r/unexpected has no Posts with Images'
        }),
        { status: 400 }
      )
    );

    await expect(
      fetchMemeApiCandidates({
        subreddit: 'Unexpected',
        count: 10,
        baseUrl: 'https://meme-api.com/gimme',
        fetch: fetchMock
      })
    ).resolves.toEqual([]);
  });

  test('throws on other non-ok responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('bad gateway', {
        status: 502
      })
    );

    await expect(
      fetchMemeApiCandidates({
        subreddit: 'memes',
        count: 10,
        fetch: fetchMock
      })
    ).rejects.toThrow('Meme API request failed with status 502');
  });

  test('creates a source client around meme-api fetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        count: 0,
        memes: []
      })
    );
    const client = createMemeApiSourceClient({ fetch: fetchMock });

    await expect(
      client.fetchCandidates({ subreddit: 'memes', count: 10 })
    ).resolves.toEqual([]);
  });
});
