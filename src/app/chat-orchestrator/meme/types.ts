export type MemeMediaKind = 'image' | 'gallery' | 'video' | 'animation';

export interface RedditPostData {
  id?: unknown;
  subreddit?: unknown;
  title?: unknown;
  permalink?: unknown;
  ups?: unknown;
  is_self?: unknown;
  url?: unknown;
  url_overridden_by_dest?: unknown;
  media?: unknown;
  secure_media?: unknown;
  gallery_data?: unknown;
  media_metadata?: unknown;
  [key: string]: unknown;
}

export interface RedditPostMediaContainer {
  reddit_video?: RedditVideo | null | undefined;
}

export interface RedditVideo {
  fallback_url?: string | undefined;
}

export interface RedditGalleryData {
  items?: RedditGalleryItem[] | undefined;
}

export interface RedditGalleryItem {
  media_id?: string | undefined;
}

export interface RedditMediaMetadata {
  s?:
    | {
        u?: string | undefined;
      }
    | undefined;
}

export type ResolvedMemeMedia =
  | ResolvedMemeImage
  | ResolvedMemeGallery
  | ResolvedMemeVideo
  | ResolvedMemeAnimation;

export interface ResolvedMemeImage {
  kind: 'image';
  mediaUrl: string;
  extension: 'jpg' | 'jpeg' | 'png' | 'webp';
}

export interface ResolvedMemeGallery {
  kind: 'gallery';
  items: ResolvedMemeGalleryItem[];
}

export interface ResolvedMemeVideo {
  kind: 'video';
  mediaUrl: string;
  extension: 'mp4';
}

export interface ResolvedMemeAnimation {
  kind: 'animation';
  mediaUrl: string;
  extension: 'gif' | 'mp4';
}

export interface ResolvedMemeGalleryItem {
  url: string;
  extension: ResolvedMemeImage['extension'];
}

export interface MemePostCandidate {
  redditPostId: string;
  subreddit: string;
  title: string;
  permalink: string;
  upvotes: number;
  media: ResolvedMemeMedia;
}

export type DownloadedMemeMedia =
  | {
      kind: 'image' | 'video' | 'animation';
      filePath: string;
      extension: string;
      cleanup: () => Promise<void>;
    }
  | {
      kind: 'gallery';
      files: Array<{
        filePath: string;
        cleanup: () => Promise<void>;
      }>;
      cleanup: () => Promise<void>;
    };

export interface SentMemeMedia {
  messageId: number;
  createdAt: string;
}

export function toMemeMediaKind(media: ResolvedMemeMedia): MemeMediaKind {
  return media.kind;
}
