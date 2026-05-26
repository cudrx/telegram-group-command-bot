import { readRedditCookieHeader } from './reddit-cookies.js';
import { resolveRedditPostMedia } from './reddit-post-resolver.js';
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
  sqlitePath?: string | undefined;
  redditCookiesPath?: string | null | undefined;
  fetch?: typeof fetch | undefined;
}): Promise<RedditPostReference | null> {
  const direct = findRedditPostReference(input.text);
  if (direct) return direct;

  const shareUrl = findRedditShareUrl(input.text);
  if (!shareUrl) return null;

  const fetchImpl = input.fetch ?? globalThis.fetch;
  const cookieHeader = await readRedditCookieHeader({
    sqlitePath: input.sqlitePath,
    redditCookiesPath: input.redditCookiesPath
  });
  let response: Response;

  try {
    response = await fetchImpl(shareUrl, {
      redirect: 'follow',
      headers: createRedditHeaders(cookieHeader)
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
  sqlitePath?: string | undefined;
  redditCookiesPath?: string | null | undefined;
  fetch?: typeof fetch | undefined;
}): Promise<MemePostCandidate | null> {
  return fetchRedditPostCandidate(input);
}

export async function fetchRedditPostCandidate(input: {
  text: string;
  sqlitePath?: string | undefined;
  redditCookiesPath?: string | null | undefined;
  fetch?: typeof fetch | undefined;
}): Promise<MemePostCandidate | null> {
  const reference = await resolveRedditPostReference(input);

  if (!reference) return null;

  const fetchImpl = input.fetch ?? globalThis.fetch;
  const cookieHeader = await readRedditCookieHeader({
    sqlitePath: input.sqlitePath,
    redditCookiesPath: input.redditCookiesPath
  });
  let response: Response;

  try {
    response = await fetchImpl(reference.jsonUrl, {
      headers: createRedditHeaders(cookieHeader)
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

  return toPostCandidate(await response.json());
}

function createRedditHeaders(cookieHeader: string | null): HeadersInit {
  return {
    ...REDDIT_HEADERS,
    ...(cookieHeader ? { Cookie: cookieHeader } : {})
  };
}

export function findRedditShareUrl(text: string): string | null {
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

function toPostCandidate(payload: unknown): MemePostCandidate | null {
  const post = getFirstPostData(payload);

  if (!post) return null;

  return resolveRedditPostMedia(post);
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

function isRedditHost(hostname: string): boolean {
  return hostname === 'reddit.com' || hostname.endsWith('.reddit.com');
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.]+$/u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
