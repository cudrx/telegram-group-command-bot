import { findInstagramReelUrl } from '../actions/meme/instagram-reel-client.js';
import {
  findRedditPostReference,
  findRedditShareUrl
} from '../actions/meme/reddit-post-client.js';
import { findTiktokUrl } from '../actions/meme/tiktok-client.js';
import { findYoutubeShortUrl } from '../actions/meme/youtube-short-client.js';

export type DirectMediaLinkKind =
  | 'reddit'
  | 'instagram_reel'
  | 'youtube_short'
  | 'tiktok';

export type DirectMediaLink = {
  kind: DirectMediaLinkKind;
};

export function detectDirectMediaLink(text: string): DirectMediaLink | null {
  if (findRedditPostReference(text) || findRedditShareUrl(text)) {
    return { kind: 'reddit' };
  }

  if (findInstagramReelUrl(text)) {
    return { kind: 'instagram_reel' };
  }

  if (findYoutubeShortUrl(text)) {
    return { kind: 'youtube_short' };
  }

  if (findTiktokUrl(text)) {
    return { kind: 'tiktok' };
  }

  return null;
}
