import { writeFile } from 'node:fs/promises';

import { expect } from 'vitest';

export async function writeNormalizedVideo(args: string[]): Promise<{
  stdout: string;
  stderr: string;
}> {
  const outputPath = args.at(-1) ?? '';
  expect(args).toContain('-vf');
  expect(args).toContain('libx264');
  expect(args).toContain('yuv420p');
  await writeFile(outputPath, new Uint8Array([1, 2, 3]));
  return { stdout: '', stderr: '' };
}

export function videoProbeResult(duration = 12): {
  stdout: string;
  stderr: string;
} {
  return {
    stdout: JSON.stringify({
      format: { duration: String(duration) },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 720,
          height: 1280
        }
      ]
    }),
    stderr: ''
  };
}

export function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

export function redditListing(posts: Array<Record<string, unknown>>) {
  return new Response(
    JSON.stringify({
      data: {
        children: posts.map((post) => {
          const subreddit =
            typeof post.subreddit === 'string' ? post.subreddit : 'memes';
          const id = String(post.id ?? 'post');

          return {
            kind: 't3',
            data: {
              subreddit,
              title: 'post title',
              permalink: `/r/${subreddit}/comments/${id}/post_title/`,
              ups: 10,
              over_18: false,
              spoiler: false,
              ...post
            }
          };
        })
      }
    })
  );
}

export function blockedRedditListing() {
  return new Response('blocked', { status: 403 });
}

export function redirectedResponse(url: string): Response {
  const response = new Response('', { status: 200 });
  Object.defineProperty(response, 'url', { value: url });

  return response;
}

export function redditPostResponse(post: Record<string, unknown>) {
  const subreddit =
    typeof post.subreddit === 'string' ? post.subreddit : 'memes';
  const id = String(post.id ?? 'post');

  return new Response(
    JSON.stringify([
      {},
      {
        data: {
          children: [
            {
              kind: 't3',
              data: {
                id,
                subreddit,
                title: 'post title',
                permalink: `/r/${subreddit}/comments/${id}/post_title/`,
                ups: 10,
                over_18: false,
                spoiler: false,
                ...post
              }
            }
          ]
        }
      }
    ])
  );
}
