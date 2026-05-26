import { describe, expect, test } from 'vitest';

import { resolveRedditPostMedia } from '../../../src/app/actions/meme/reddit-post-resolver.js';

describe('resolveRedditPostMedia', () => {
  test('resolves Reddit-hosted video posts', () => {
    expect(
      resolveRedditPostMedia(
        redditPost({
          id: 'vid1',
          subreddit: 'SipsTea',
          title: 'video post',
          permalink: '/r/SipsTea/comments/vid1/video_post/',
          ups: 456,
          secure_media: {
            reddit_video: {
              fallback_url:
                'https://v.redd.it/video-post/DASH_720.mp4?source=fallback',
              duration: 37
            }
          }
        })
      )
    ).toEqual({
      redditPostId: 'vid1',
      subreddit: 'SipsTea',
      title: 'video post',
      permalink: 'https://www.reddit.com/r/SipsTea/comments/vid1/video_post/',
      upvotes: 456,
      media: {
        kind: 'video',
        mediaUrl: 'https://www.reddit.com/r/SipsTea/comments/vid1/video_post/',
        extension: 'mp4',
        durationSeconds: 37,
        downloadStrategy: 'yt-dlp'
      }
    });
  });

  test('resolves direct Reddit image posts', () => {
    expect(
      resolveRedditPostMedia(
        redditPost({
          id: 'img1',
          subreddit: 'memes',
          title: 'image post',
          permalink: '/r/memes/comments/img1/image_post/',
          ups: 123,
          url: 'https://i.redd.it/image-post.jpeg?width=960'
        })
      )
    ).toEqual({
      redditPostId: 'img1',
      subreddit: 'memes',
      title: 'image post',
      permalink: 'https://www.reddit.com/r/memes/comments/img1/image_post/',
      upvotes: 123,
      media: {
        kind: 'image',
        mediaUrl: 'https://i.redd.it/image-post.jpeg?width=960',
        extension: 'jpeg'
      }
    });
  });

  test('resolves Reddit gallery posts and applies spoiler to every item', () => {
    expect(
      resolveRedditPostMedia(
        redditPost({
          id: 'gal1',
          subreddit: 'pics',
          title: 'gallery post',
          permalink: '/r/pics/comments/gal1/gallery_post/',
          ups: 789,
          is_gallery: true,
          over_18: true,
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
              m: 'image/png',
              s: {
                u: 'https://preview.redd.it/b2.png?width=640&amp;format=png'
              }
            }
          }
        })
      )
    ).toEqual({
      redditPostId: 'gal1',
      subreddit: 'pics',
      title: 'gallery post',
      permalink: 'https://www.reddit.com/r/pics/comments/gal1/gallery_post/',
      upvotes: 789,
      media: {
        kind: 'gallery',
        items: [
          {
            mediaUrl: 'https://preview.redd.it/a1.jpg?width=640&format=pjpg',
            extension: 'jpg',
            hasSpoiler: true
          },
          {
            mediaUrl: 'https://preview.redd.it/b2.png?width=640&format=png',
            extension: 'png',
            hasSpoiler: true
          }
        ],
        hasSpoiler: true
      }
    });
  });

  test('ignores self text and external link posts', () => {
    expect(
      resolveRedditPostMedia(
        redditPost({
          id: 'text1',
          is_self: true,
          selftext: 'hello',
          url: 'https://www.reddit.com/r/memes/comments/text1/text_post/'
        })
      )
    ).toBeNull();
    expect(
      resolveRedditPostMedia(
        redditPost({
          id: 'link1',
          url: 'https://example.com/story'
        })
      )
    ).toBeNull();
  });
});

function redditPost(data: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'post',
    subreddit: 'memes',
    title: 'post title',
    permalink: `/r/memes/comments/${String(data.id ?? 'post')}/post_title/`,
    ups: 10,
    over_18: false,
    spoiler: false,
    ...data
  };
}
