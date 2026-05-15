import type { MediaMessageSnapshot } from '../../../domain/models.js';

export type MemeMediaKind = 'image';

export type ResolvedMemeMedia = ResolvedMemeImage;

export interface ResolvedMemeImage {
  kind: 'image';
  mediaUrl: string;
  extension: 'jpg' | 'jpeg' | 'png' | 'webp';
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

export type DownloadedMemeMedia = {
  kind: 'image';
  filePath: string;
  extension: ResolvedMemeImage['extension'];
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
