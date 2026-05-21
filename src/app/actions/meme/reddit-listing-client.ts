import { readRedditCookieHeader } from './reddit-cookies.js';
import type {
  FetchMemeSourceCandidatesInput,
  MemePostCandidate,
  MemeSourceClient,
  ResolvedMemeMedia
} from './types.js';

export interface FetchRedditListingCandidatesInput
  extends FetchMemeSourceCandidatesInput {
  timeRange?: RedditListingTimeRange;
  sqlitePath?: string;
  fetch?: typeof fetch;
}

export interface RedditListingSourceClientOptions {
  timeRange?: RedditListingTimeRange;
  fetch?: typeof fetch;
}

type RedditListingTimeRange =
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year'
  | 'all';

const DEFAULT_TIME_RANGE: RedditListingTimeRange = 'week';
const REDDIT_BASE_URL = 'https://www.reddit.com';
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

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
  const cookieHeader = await readRedditCookieHeader(input.sqlitePath);

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
  if (post.over_18 === true || post.spoiler === true) return null;

  const id = getRequiredString(post.id);
  const subreddit = getRequiredString(post.subreddit);
  const title = getRequiredString(post.title);
  const permalinkPath = getRequiredString(post.permalink);

  if (!id || !subreddit || !title || !permalinkPath) return null;

  const permalink = new URL(permalinkPath, REDDIT_BASE_URL).toString();
  const media = resolveMedia(post, permalink);

  if (!media) return null;

  return {
    redditPostId: id,
    subreddit,
    title,
    permalink,
    upvotes: getNumber(post.ups) ?? 0,
    media
  };
}

function resolveMedia(
  post: Record<string, unknown>,
  permalink: string
): ResolvedMemeMedia | null {
  const redditVideo = getRedditVideo(post);

  if (redditVideo) {
    return {
      kind: 'video',
      mediaUrl: permalink,
      extension: 'mp4',
      durationSeconds: getNumber(redditVideo.duration) ?? null,
      downloadStrategy: 'yt-dlp'
    };
  }

  const directUrl = getRequiredString(post.url);
  const imageMedia = directUrl ? resolveImage(directUrl) : null;

  if (imageMedia) return imageMedia;

  return resolvePreviewImage(post);
}

function resolveImage(url: string): ResolvedMemeMedia | null {
  const mediaUrl = decodeHtmlEntities(url);
  const parsed = parseUrl(mediaUrl);

  if (!parsed || parsed.hostname !== 'i.redd.it') return null;

  const extension = getExtension(parsed);
  if (!IMAGE_EXTENSIONS.has(extension)) return null;

  return {
    kind: 'image',
    mediaUrl,
    extension: extension as 'jpg' | 'jpeg' | 'png' | 'webp'
  };
}

function resolvePreviewImage(
  post: Record<string, unknown>
): ResolvedMemeMedia | null {
  const preview = isRecord(post.preview) ? post.preview : null;
  const images = Array.isArray(preview?.images) ? preview.images : [];
  const firstImage = isRecord(images[0]) ? images[0] : null;
  const source = isRecord(firstImage?.source) ? firstImage.source : null;
  const sourceUrl = getRequiredString(source?.url);

  return sourceUrl ? resolveImage(sourceUrl) : null;
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

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function getExtension(url: URL): string {
  return url.pathname.split('.').at(-1)?.toLowerCase() ?? '';
}

function decodeHtmlEntities(value: string): string {
  return value.replaceAll('&amp;', '&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
