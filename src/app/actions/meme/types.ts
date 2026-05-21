import type { MediaMessageSnapshot } from '../../../domain/models.js';

export type MemeMediaKind = 'image' | 'video';

export type ResolvedMemeMedia = ResolvedMemeImage | ResolvedMemeVideo;

export interface ResolvedMemeImage {
  kind: 'image';
  mediaUrl: string;
  extension: 'jpg' | 'jpeg' | 'png' | 'webp';
  hasSpoiler?: boolean;
}

export interface ResolvedMemeVideo {
  kind: 'video';
  mediaUrl: string;
  extension: 'mp4';
  durationSeconds?: number | null;
  downloadStrategy?: 'direct' | 'yt-dlp';
  hasSpoiler?: boolean;
}

export interface MemePostCandidate {
  redditPostId: string;
  subreddit: string;
  title: string;
  permalink: string;
  upvotes: number;
  media: ResolvedMemeMedia;
}

export interface FetchMemeSourceCandidatesInput {
  subreddit: string;
  count: number;
}

export interface MemeSourceClient {
  fetchCandidates(
    input: FetchMemeSourceCandidatesInput
  ): Promise<MemePostCandidate[]>;
}

export type DownloadedMemeMedia =
  | {
      kind: 'image';
      filePath: string;
      extension: ResolvedMemeImage['extension'];
      cleanup: () => Promise<void>;
    }
  | {
      kind: 'video';
      filePath: string;
      extension: ResolvedMemeVideo['extension'];
      durationSeconds?: number | null;
      cleanup: () => Promise<void>;
    };

export interface SentMemeMedia {
  messageId: number;
  createdAt: string;
  mediaSnapshot?: MediaMessageSnapshot | null;
}

export function toMemeMediaKind(media: ResolvedMemeMedia): MemeMediaKind {
  return media.kind;
}
