import type { RedditPostData } from './types.js';

export interface FetchTopRedditPostsInput {
  listingUrlBase: string;
  subreddit: string;
  timeRange: string;
  limit: number;
  userAgent: string;
  fetch?: typeof fetch;
}

export async function fetchTopRedditPosts(
  input: FetchTopRedditPostsInput
): Promise<RedditPostData[]> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const url = `${input.listingUrlBase}/${encodeURIComponent(
    input.subreddit
  )}/top.json?t=${input.timeRange}&limit=${input.limit}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': input.userAgent
    }
  });

  if (!response.ok) {
    throw new Error(`Reddit listing failed with status ${response.status}`);
  }

  const listing = await response.json();
  const children = getListingChildren(listing);

  return children
    .map((child) => child.data)
    .filter(isRecord)
    .map((data) => data as RedditPostData);
}

function getListingChildren(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !isRecord(value.data)) return [];

  return Array.isArray(value.data.children)
    ? value.data.children.filter(isRecord)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
