import type {
  MemePostCandidate,
  RedditPostData,
  ResolvedMemeAnimation,
  ResolvedMemeGallery,
  ResolvedMemeGalleryItem,
  ResolvedMemeImage,
  ResolvedMemeMedia,
  ResolvedMemeVideo
} from './types.js';

const REDDIT_IMAGE_HOSTS = new Set(['i.redd.it', 'preview.redd.it']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MAX_GALLERY_ITEMS = 10;

export function resolveRedditPostMedia(
  post: RedditPostData
): ResolvedMemeMedia | null {
  if (post.is_self === true) return null;

  const gallery = resolveGallery(post);
  if (gallery) return gallery;

  const video = resolveRedditVideo(post);
  if (video) return video;

  const url = getString(post.url_overridden_by_dest) ?? getString(post.url);
  if (!url) return null;

  return resolveRedditImageOrAnimation(url);
}

export function toMemePostCandidate(
  post: RedditPostData
): MemePostCandidate | null {
  const media = resolveRedditPostMedia(post);
  if (!media) return null;

  const redditPostId = getRequiredString(post.id);
  const subreddit = getRequiredString(post.subreddit);
  const title = getRequiredString(post.title);
  const permalink = getRequiredString(post.permalink);
  if (!redditPostId || !subreddit || !title || !permalink) return null;

  return {
    redditPostId,
    subreddit,
    title,
    permalink,
    upvotes: getNumber(post.ups) ?? 0,
    media
  };
}

function resolveGallery(
  post: RedditPostData
): ResolvedMemeGallery | ResolvedMemeImage | null {
  const items = getGalleryItems(post.gallery_data);
  const metadata = getMediaMetadata(post.media_metadata);
  if (items.length === 0 || !metadata) return null;

  const resolvedItems: ResolvedMemeGalleryItem[] = [];
  for (const item of items) {
    if (resolvedItems.length >= MAX_GALLERY_ITEMS) break;

    const mediaId = getString(item.media_id);
    const url = mediaId ? getMetadataUrl(metadata[mediaId]) : undefined;
    if (!url) continue;

    const media = resolveRedditImage(url);
    if (media) {
      resolvedItems.push({
        url: media.mediaUrl,
        extension: media.extension
      });
    }
  }

  if (resolvedItems.length === 0) return null;
  if (resolvedItems.length === 1) {
    const item = resolvedItems[0];
    if (!item) return null;

    return {
      kind: 'image',
      mediaUrl: item.url,
      extension: item.extension
    };
  }

  return {
    kind: 'gallery',
    items: resolvedItems
  };
}

function resolveRedditVideo(post: RedditPostData): ResolvedMemeVideo | null {
  const fallbackUrl =
    getRedditVideoFallbackUrl(post.media) ??
    getRedditVideoFallbackUrl(post.secure_media);
  if (!fallbackUrl) return null;

  const mediaUrl = decodeHtmlEntities(fallbackUrl);
  const parsed = parseUrl(mediaUrl);
  if (!parsed || parsed.hostname !== 'v.redd.it') return null;

  return {
    kind: 'video',
    mediaUrl,
    extension: 'mp4'
  };
}

function resolveRedditImageOrAnimation(
  url: string
): ResolvedMemeImage | ResolvedMemeAnimation | null {
  const image = resolveRedditImage(url);
  if (image) return image;

  const parsed = parseUrl(url);
  if (!parsed || !REDDIT_IMAGE_HOSTS.has(parsed.hostname)) return null;

  const extension = getExtension(parsed);
  if (extension !== 'gif' && extension !== 'mp4') return null;

  return {
    kind: 'animation',
    mediaUrl: decodeHtmlEntities(url),
    extension
  };
}

function resolveRedditImage(url: string): ResolvedMemeImage | null {
  const mediaUrl = decodeHtmlEntities(url);
  const parsed = parseUrl(mediaUrl);
  if (!parsed || !REDDIT_IMAGE_HOSTS.has(parsed.hostname)) return null;

  const extension = getExtension(parsed);
  if (!IMAGE_EXTENSIONS.has(extension)) return null;

  return {
    kind: 'image',
    mediaUrl,
    extension: extension as ResolvedMemeImage['extension']
  };
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

function getGalleryItems(value: unknown): Array<{ media_id?: unknown }> {
  if (!value || typeof value !== 'object') return [];

  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

function getMediaMetadata(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function getMetadataUrl(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const source = (value as { s?: unknown }).s;
  if (!source || typeof source !== 'object') return undefined;

  return getString((source as { u?: unknown }).u);
}

function getRedditVideoFallbackUrl(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const redditVideo = (value as { reddit_video?: unknown }).reddit_video;
  if (!redditVideo || typeof redditVideo !== 'object') return undefined;

  return getString((redditVideo as { fallback_url?: unknown }).fallback_url);
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
