import { readRedditCookieHeader } from './reddit-cookies.js';
import { resolveRedditPostMedia } from './reddit-post-resolver.js';
import type {
  FetchMemeSourceCandidatesInput,
  MemePostCandidate,
  MemeSourceClient
} from './types.js';

export interface FetchRedditListingCandidatesInput
  extends FetchMemeSourceCandidatesInput {
  redditCookieHeaderPath?: string | null;
  timeRange?: RedditListingTimeRange;
  sqlitePath?: string;
  redditCookiesPath?: string | null;
  fetch?: typeof fetch;
}

export interface RedditListingSourceClientOptions {
  timeRange?: RedditListingTimeRange;
  fetch?: typeof fetch;
}

export type RedditListingTimeRange =
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year'
  | 'all';

const DEFAULT_TIME_RANGE: RedditListingTimeRange = 'week';
const REDDIT_BASE_URL = 'https://www.reddit.com';

export function createRedditListingSourceClient(
  options: RedditListingSourceClientOptions = {}
): MemeSourceClient {
  return {
    fetchCandidates(input) {
      return fetchRedditListingCandidates({
        ...input,
        ...options
      });
    }
  };
}

export async function fetchRedditListingCandidates(
  input: FetchRedditListingCandidatesInput
): Promise<MemePostCandidate[]> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const url = new URL(
    `/r/${encodeURIComponent(input.subreddit)}/top/.json`,
    REDDIT_BASE_URL
  );
  url.searchParams.set('t', input.timeRange ?? DEFAULT_TIME_RANGE);
  url.searchParams.set('limit', String(input.count));
  const cookieHeader = await readRedditCookieHeader({
    redditCookieHeaderPath: input.redditCookieHeaderPath,
    sqlitePath: input.sqlitePath,
    redditCookiesPath: input.redditCookiesPath
  });

  const response = await fetchImpl(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'test-chatbot/0.1 by /u/local-test',
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    }
  });

  if (!response.ok) {
    if (response.status === 403 || response.status === 404) return [];

    throw new Error(
      `Reddit listing request failed for r/${input.subreddit} with status ${response.status}`
    );
  }

  return getChildren(await response.json())
    .map(toCandidate)
    .filter((candidate): candidate is MemePostCandidate => Boolean(candidate));
}

function getChildren(value: unknown): unknown[] {
  const data = isRecord(value) ? value.data : null;
  const children = isRecord(data) ? data.children : null;

  return Array.isArray(children) ? children : [];
}

function toCandidate(child: unknown): MemePostCandidate | null {
  const post = isRecord(child) && isRecord(child.data) ? child.data : null;

  if (!post) return null;
  return resolveRedditPostMedia(post);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
