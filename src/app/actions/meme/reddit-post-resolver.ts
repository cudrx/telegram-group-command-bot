import type {
  MemePostCandidate,
  ResolvedMemeImage,
  ResolvedMemeMedia
} from './types.js';

const REDDIT_BASE_URL = 'https://www.reddit.com';
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export function resolveRedditPostMedia(
  post: Record<string, unknown>
): MemePostCandidate | null {
  const id = getRequiredString(post.id);
  const subreddit = getRequiredString(post.subreddit);
  const title = getRequiredString(post.title);
  const permalinkPath = getRequiredString(post.permalink);

  if (!id || !subreddit || !title || !permalinkPath) return null;

  const permalink = new URL(permalinkPath, REDDIT_BASE_URL).toString();
  const hasSpoiler = post.over_18 === true || post.spoiler === true;
  const media = resolveMedia(post, permalink, hasSpoiler);

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
  permalink: string,
  hasSpoiler: boolean
): ResolvedMemeMedia | null {
  const redditVideo = getRedditVideo(post);
  const fallbackUrl = getRequiredString(redditVideo?.fallback_url);

  if (fallbackUrl) {
    return {
      kind: 'video',
      mediaUrl: permalink,
      extension: 'mp4',
      durationSeconds: getNumber(redditVideo?.duration) ?? null,
      downloadStrategy: 'yt-dlp',
      ...(hasSpoiler ? { hasSpoiler: true } : {})
    };
  }

  const gallery = resolveGallery(post, hasSpoiler);
  if (gallery) return gallery;

  const directUrl = getRequiredString(post.url);
  const imageMedia = directUrl ? resolveImage(directUrl, hasSpoiler) : null;
  if (imageMedia) return imageMedia;

  return resolvePreviewImage(post, hasSpoiler);
}

function resolveGallery(
  post: Record<string, unknown>,
  hasSpoiler: boolean
): ResolvedMemeMedia | null {
  if (post.is_gallery !== true) return null;

  const galleryData = isRecord(post.gallery_data) ? post.gallery_data : null;
  const mediaMetadata = isRecord(post.media_metadata)
    ? post.media_metadata
    : null;
  const items = Array.isArray(galleryData?.items) ? galleryData.items : [];
  const resolvedItems = items
    .map((item) => {
      if (!isRecord(item) || !mediaMetadata) return null;

      const mediaId = getRequiredString(item.media_id);
      const metadata = mediaId ? mediaMetadata[mediaId] : null;
      const source =
        isRecord(metadata) && isRecord(metadata.s) ? metadata.s : null;
      const sourceUrl = getRequiredString(source?.u);
      const image = sourceUrl
        ? resolveGalleryImage(sourceUrl, hasSpoiler)
        : null;

      return image;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (resolvedItems.length === 0) return null;

  return {
    kind: 'gallery',
    items: resolvedItems,
    ...(hasSpoiler ? { hasSpoiler: true } : {})
  };
}

function resolveGalleryImage(url: string, hasSpoiler: boolean) {
  const image = resolveImage(url, hasSpoiler);

  if (!image) return null;

  return {
    mediaUrl: image.mediaUrl,
    extension: image.extension,
    ...(hasSpoiler ? { hasSpoiler: true } : {})
  };
}

function resolveImage(
  url: string,
  hasSpoiler: boolean
): ResolvedMemeImage | null {
  const mediaUrl = decodeHtmlEntities(url);
  const parsed = parseUrl(mediaUrl);

  if (!parsed || !isRedditImageHost(parsed.hostname)) return null;

  const extension = getImageExtension(parsed);
  if (!IMAGE_EXTENSIONS.has(extension)) return null;

  return {
    kind: 'image',
    mediaUrl,
    extension: extension as 'jpg' | 'jpeg' | 'png' | 'webp',
    ...(hasSpoiler ? { hasSpoiler: true } : {})
  };
}

function resolvePreviewImage(
  post: Record<string, unknown>,
  hasSpoiler: boolean
): ResolvedMemeMedia | null {
  const preview = isRecord(post.preview) ? post.preview : null;
  const images = Array.isArray(preview?.images) ? preview.images : [];
  const firstImage = isRecord(images[0]) ? images[0] : null;
  const source = isRecord(firstImage?.source) ? firstImage.source : null;
  const sourceUrl = getRequiredString(source?.url);

  return sourceUrl ? resolveImage(sourceUrl, hasSpoiler) : null;
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

function getImageExtension(url: URL): string {
  const fromPath = url.pathname.split('.').at(-1)?.toLowerCase() ?? '';

  if (fromPath === 'jpg' || fromPath === 'jpeg' || fromPath === 'png') {
    return fromPath;
  }

  const format = url.searchParams.get('format')?.toLowerCase();
  if (format === 'pjpg') return 'jpg';
  if (format && IMAGE_EXTENSIONS.has(format)) return format;

  return fromPath;
}

function isRedditImageHost(hostname: string): boolean {
  return hostname === 'i.redd.it' || hostname === 'preview.redd.it';
}

function decodeHtmlEntities(value: string): string {
  return value.replaceAll('&amp;', '&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
