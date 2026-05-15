import type {
  FetchMemeSourceCandidatesInput,
  MemePostCandidate,
  MemeSourceClient,
  ResolvedMemeMedia
} from './types.js';

export interface FetchMemeApiCandidatesInput
  extends FetchMemeSourceCandidatesInput {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface MemeApiSourceClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://meme-api.com/gimme';
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export function createMemeApiSourceClient(
  options: MemeApiSourceClientOptions = {}
): MemeSourceClient {
  return {
    fetchCandidates(input) {
      return fetchMemeApiCandidates({
        ...input,
        ...options
      });
    }
  };
}

export async function fetchMemeApiCandidates(
  input: FetchMemeApiCandidatesInput
): Promise<MemePostCandidate[]> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const url = `${input.baseUrl ?? DEFAULT_BASE_URL}/${encodeURIComponent(
    input.subreddit
  )}/${input.count}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    if (response.status === 400 && (await isImageEmptyResponse(response))) {
      return [];
    }

    throw new Error(`Meme API request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const memes = getMemes(payload);

  return memes
    .map(toCandidate)
    .filter((candidate): candidate is MemePostCandidate => Boolean(candidate));
}

function getMemes(value: unknown): unknown[] {
  if (!isRecord(value)) return [];

  return Array.isArray(value.memes) ? value.memes : [];
}

async function isImageEmptyResponse(response: Response): Promise<boolean> {
  try {
    const payload = await response.clone().json();
    const message = isRecord(payload) ? getString(payload.message) : undefined;

    return message?.includes('has no Posts with Images') === true;
  } catch {
    const text = await response.clone().text();

    return text.includes('has no Posts with Images');
  }
}

function toCandidate(value: unknown): MemePostCandidate | null {
  if (!isRecord(value)) return null;
  if (value.nsfw === true || value.spoiler === true) return null;

  const postLink = getRequiredString(value.postLink);
  const subreddit = getRequiredString(value.subreddit);
  const title = getRequiredString(value.title);
  const url = getRequiredString(value.url);
  if (!subreddit || !title || !url) return null;

  const media = resolveMedia(url);
  if (!media) return null;
  const permalink = postLink ?? url;

  return {
    redditPostId: postLink ? (getPostId(postLink) ?? postLink) : url,
    subreddit,
    title,
    permalink,
    upvotes: getNumber(value.ups) ?? 0,
    media
  };
}

function resolveMedia(url: string): ResolvedMemeMedia | null {
  const mediaUrl = decodeHtmlEntities(url);
  const parsed = parseUrl(mediaUrl);
  if (!parsed) return null;

  const extension = getExtension(parsed);
  if (IMAGE_EXTENSIONS.has(extension)) {
    return {
      kind: 'image',
      mediaUrl,
      extension: extension as 'jpg' | 'jpeg' | 'png' | 'webp'
    };
  }

  return null;
}

function getPostId(postLink: string): string | null {
  const parsed = parseUrl(postLink);
  if (!parsed || parsed.hostname !== 'redd.it') return null;

  return parsed.pathname.split('/').filter(Boolean)[0] ?? null;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getRequiredString(value: unknown): string | undefined {
  const stringValue = getString(value)?.trim();
  return stringValue ? stringValue : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
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
