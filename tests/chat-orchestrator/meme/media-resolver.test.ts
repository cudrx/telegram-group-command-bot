import { describe, expect, test } from 'vitest';

import {
  resolveRedditPostMedia,
  toMemePostCandidate
} from '../../../src/app/chat-orchestrator/meme/media-resolver.js';
import type { RedditPostData } from '../../../src/app/chat-orchestrator/meme/types.js';

function post(overrides: Partial<RedditPostData>): RedditPostData {
  return {
    id: 'abc123',
    subreddit: 'memes',
    title: 'A title',
    permalink: '/r/memes/comments/abc123/a_title/',
    ups: 42,
    is_self: false,
    ...overrides
  };
}

describe('resolveRedditPostMedia', () => {
  test('resolves reddit-hosted images from url_overridden_by_dest', () => {
    expect(
      resolveRedditPostMedia(
        post({
          url_overridden_by_dest: 'https://i.redd.it/example.webp?width=640'
        })
      )
    ).toEqual({
      kind: 'image',
      mediaUrl: 'https://i.redd.it/example.webp?width=640',
      extension: 'webp'
    });
  });

  test('html-decodes direct reddit-hosted image URLs before returning', () => {
    expect(
      resolveRedditPostMedia(
        post({
          url: 'https://preview.redd.it/a.jpg?width=640&amp;format=pjpg'
        })
      )
    ).toEqual({
      kind: 'image',
      mediaUrl: 'https://preview.redd.it/a.jpg?width=640&format=pjpg',
      extension: 'jpg'
    });
  });

  test('resolves reddit-hosted gifs as animation media', () => {
    expect(
      resolveRedditPostMedia(
        post({
          url: 'https://preview.redd.it/example.gif?format=png8'
        })
      )
    ).toEqual({
      kind: 'animation',
      mediaUrl: 'https://preview.redd.it/example.gif?format=png8',
      extension: 'gif'
    });
  });

  test('resolves direct reddit-hosted mp4 URLs as animation media', () => {
    expect(
      resolveRedditPostMedia(
        post({
          url_overridden_by_dest:
            'https://preview.redd.it/example.mp4?width=640&amp;format=mp4'
        })
      )
    ).toEqual({
      kind: 'animation',
      mediaUrl: 'https://preview.redd.it/example.mp4?width=640&format=mp4',
      extension: 'mp4'
    });
  });

  test('resolves reddit videos from secure media fallback URLs', () => {
    expect(
      resolveRedditPostMedia(
        post({
          secure_media: {
            reddit_video: {
              fallback_url:
                'https://v.redd.it/video-id/DASH_720.mp4?source=fallback'
            }
          }
        })
      )
    ).toEqual({
      kind: 'video',
      mediaUrl: 'https://v.redd.it/video-id/DASH_720.mp4?source=fallback',
      extension: 'mp4'
    });
  });

  test('html-decodes reddit video fallback URLs before returning', () => {
    expect(
      resolveRedditPostMedia(
        post({
          media: {
            reddit_video: {
              fallback_url:
                'https://v.redd.it/video-id/DASH_720.mp4?source=fallback&amp;foo=bar'
            }
          }
        })
      )
    ).toEqual({
      kind: 'video',
      mediaUrl:
        'https://v.redd.it/video-id/DASH_720.mp4?source=fallback&foo=bar',
      extension: 'mp4'
    });
  });

  test('resolves galleries in gallery_data order and decodes html entities', () => {
    expect(
      resolveRedditPostMedia(
        post({
          gallery_data: {
            items: [
              { media_id: 'second' },
              { media_id: 'first' },
              { media_id: 'third' }
            ]
          },
          media_metadata: {
            first: {
              s: {
                u: 'https://preview.redd.it/first.jpg?width=640&amp;format=pjpg'
              }
            },
            third: {
              s: {
                u: 'https://external.example/third.jpg'
              }
            },
            second: {
              s: {
                u: 'https://preview.redd.it/second.png?width=640&amp;format=png'
              }
            }
          }
        })
      )
    ).toEqual({
      kind: 'gallery',
      items: [
        {
          url: 'https://preview.redd.it/second.png?width=640&format=png',
          extension: 'png'
        },
        {
          url: 'https://preview.redd.it/first.jpg?width=640&format=pjpg',
          extension: 'jpg'
        }
      ]
    });
  });

  test('caps galleries at ten resolved items', () => {
    const media = resolveRedditPostMedia(
      post({
        gallery_data: {
          items: Array.from({ length: 12 }, (_, index) => ({
            media_id: `item-${index + 1}`
          }))
        },
        media_metadata: Object.fromEntries(
          Array.from({ length: 12 }, (_, index) => [
            `item-${index + 1}`,
            {
              s: {
                u: `https://i.redd.it/item-${index + 1}.jpg`
              }
            }
          ])
        )
      })
    );

    expect(media).toMatchObject({ kind: 'gallery' });
    expect(media?.kind === 'gallery' ? media.items : []).toHaveLength(10);
  });

  test('resolves one-item galleries as a single image', () => {
    expect(
      resolveRedditPostMedia(
        post({
          gallery_data: {
            items: [{ media_id: 'only' }]
          },
          media_metadata: {
            only: {
              s: {
                u: 'https://preview.redd.it/only.jpg?width=640&amp;format=pjpg'
              }
            }
          }
        })
      )
    ).toEqual({
      kind: 'image',
      mediaUrl: 'https://preview.redd.it/only.jpg?width=640&format=pjpg',
      extension: 'jpg'
    });
  });

  test('returns null when a gallery has no supported images after filtering', () => {
    expect(
      resolveRedditPostMedia(
        post({
          gallery_data: {
            items: [{ media_id: 'external' }]
          },
          media_metadata: {
            external: {
              s: {
                u: 'https://external.example/only.jpg'
              }
            }
          }
        })
      )
    ).toBeNull();
  });

  test('skips self posts and unsupported external links', () => {
    expect(
      resolveRedditPostMedia(
        post({
          is_self: true,
          url: 'https://i.redd.it/example.jpg'
        })
      )
    ).toBeNull();
    expect(
      resolveRedditPostMedia(post({ url: 'https://imgur.com/a/abc' }))
    ).toBeNull();
  });
});

describe('toMemePostCandidate', () => {
  test('maps supported posts to meme candidates with default upvotes', () => {
    expect(
      toMemePostCandidate(
        post({
          ups: undefined,
          url: 'https://i.redd.it/example.jpg'
        })
      )
    ).toEqual({
      redditPostId: 'abc123',
      subreddit: 'memes',
      title: 'A title',
      permalink: '/r/memes/comments/abc123/a_title/',
      upvotes: 0,
      media: {
        kind: 'image',
        mediaUrl: 'https://i.redd.it/example.jpg',
        extension: 'jpg'
      }
    });
  });

  test('returns null for unsupported posts', () => {
    expect(
      toMemePostCandidate(post({ url: 'https://example.com/meme.jpg' }))
    ).toBeNull();
  });

  test('returns null when required fields are missing or blank', () => {
    expect(
      toMemePostCandidate(
        post({
          id: undefined,
          url: 'https://i.redd.it/example.jpg'
        })
      )
    ).toBeNull();
    expect(
      toMemePostCandidate(
        post({
          title: '   ',
          url: 'https://i.redd.it/example.jpg'
        })
      )
    ).toBeNull();
  });
});
