import type { MemePostCandidate } from './types.js';

type RedditPostReference = {
  jsonUrl: string;
  permalink: string;
  redditPostId: string;
  subreddit: string;
};

const REDDIT_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'test-chatbot/0.1 by /u/local-test'
};

export function findRedditPostReference(
  text: string
): RedditPostReference | null {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];

  for (const match of matches) {
    const parsed = parseRedditPostUrl(match);

    if (parsed) return parsed;
  }

  return null;
}

export async function resolveRedditPostReference(input: {
  text: string;
  fetch?: typeof fetch | undefined;
}): Promise<RedditPostReference | null> {
  const direct = findRedditPostReference(input.text);
  if (direct) return direct;

  const shareUrl = findRedditShareUrl(input.text);
  if (!shareUrl) return null;

  const fetchImpl = input.fetch ?? globalThis.fetch;
  let response: Response;

  try {
    response = await fetchImpl(shareUrl, {
      redirect: 'follow',
      headers: REDDIT_HEADERS
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Reddit share link resolution failed for ${shareUrl}: ${message}`
    );
  }

  const redirectedUrl = response.url;
  if (!redirectedUrl) return null;

  return parseRedditPostUrl(redirectedUrl);
}

export async function fetchRedditVideoCandidate(input: {
  text: string;
  fetch?: typeof fetch | undefined;
}): Promise<MemePostCandidate | null> {
  const reference = await resolveRedditPostReference(input);

  if (!reference) return null;

  const fetchImpl = input.fetch ?? globalThis.fetch;
  let response: Response;

  try {
    response = await fetchImpl(reference.jsonUrl, {
      headers: REDDIT_HEADERS
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Reddit post request failed for ${reference.jsonUrl}: ${message}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Reddit post request failed for ${reference.jsonUrl} with status ${response.status}`
    );
  }

  return toVideoCandidate(await response.json());
}

function findRedditShareUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];

  for (const match of matches) {
    const parsed = parseRedditShareUrl(match);

    if (parsed) return parsed;
  }

  return null;
}

function parseRedditShareUrl(value: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(stripTrailingPunctuation(value));
  } catch {
    return null;
  }

  if (!isRedditHost(parsed.hostname)) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  const subredditIndex = parts.findIndex((part) => part.toLowerCase() === 'r');

  if (
    subredditIndex < 0 ||
    parts[subredditIndex + 1] === undefined ||
    parts[subredditIndex + 2]?.toLowerCase() !== 's' ||
    parts[subredditIndex + 3] === undefined
  ) {
    return null;
  }

  parsed.hash = '';

  return parsed.toString();
}

function parseRedditPostUrl(value: string): RedditPostReference | null {
  let parsed: URL;

  try {
    parsed = new URL(stripTrailingPunctuation(value));
  } catch {
    return null;
  }

  if (!isRedditHost(parsed.hostname)) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  const subredditIndex = parts.findIndex((part) => part.toLowerCase() === 'r');

  if (
    subredditIndex < 0 ||
    parts[subredditIndex + 1] === undefined ||
    parts[subredditIndex + 2]?.toLowerCase() !== 'comments' ||
    parts[subredditIndex + 3] === undefined
  ) {
    return null;
  }

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = `/${parts.slice(0, subredditIndex + 5).join('/')}`;

  return {
    jsonUrl: `${parsed.toString().replace(/\/$/, '')}/.json`,
    permalink: `${parsed.toString().replace(/\/$/, '')}/`,
    redditPostId: parts[subredditIndex + 3] as string,
    subreddit: parts[subredditIndex + 1] as string
  };
}

function toVideoCandidate(payload: unknown): MemePostCandidate | null {
  const post = getFirstPostData(payload);

  if (!post) return null;
  if (post.over_18 === true || post.spoiler === true) return null;

  const redditVideo = getRedditVideo(post);
  const fallbackUrl = getRequiredString(redditVideo?.fallback_url);

  if (!fallbackUrl) return null;

  const id = getRequiredString(post.id);
  const subreddit = getRequiredString(post.subreddit);
  const title = getRequiredString(post.title);
  const permalinkPath = getRequiredString(post.permalink);

  if (!id || !subreddit || !title || !permalinkPath) return null;

  return {
    redditPostId: id,
    subreddit,
    title,
    permalink: new URL(permalinkPath, 'https://www.reddit.com').toString(),
    upvotes: getNumber(post.ups) ?? 0,
    media: {
      kind: 'video',
      mediaUrl: decodeHtmlEntities(fallbackUrl),
      extension: 'mp4',
      durationSeconds: getNumber(redditVideo?.duration) ?? null
    }
  };
}

function getFirstPostData(payload: unknown): Record<string, unknown> | null {
  if (!Array.isArray(payload)) return null;

  for (const listing of payload) {
    const data = isRecord(listing) ? listing.data : null;
    const children = isRecord(data) ? data.children : null;
    const child = Array.isArray(children) ? children[0] : null;
    const postData = isRecord(child) ? child.data : null;

    if (isRecord(postData)) return postData;
  }

  return null;
}

function getRedditVideo(
  post: Record<string, unknown>
): Record<string, unknown> | null {
  const secureMedia = isRecord(post.secure_media) ? post.secure_media : null;
  const secureVideo = isRecord(secureMedia?.reddit_video)
    ? secureMedia.reddit_video
    : null;

  if (secureVideo) return secureVideo;

  const media = isRecord(post.media) ? post.media : null;
  const mediaVideo = isRecord(media?.reddit_video) ? media.reddit_video : null;

  return mediaVideo;
}

function isRedditHost(hostname: string): boolean {
  return hostname === 'reddit.com' || hostname.endsWith('.reddit.com');
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.]+$/u, '');
}

function getRequiredString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function decodeHtmlEntities(value: string): string {
  return value.replaceAll('&amp;', '&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
