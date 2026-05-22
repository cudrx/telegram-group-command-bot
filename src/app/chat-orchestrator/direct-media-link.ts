import { findInstagramReelUrl } from '../actions/meme/instagram-reel-client.js';
import {
  findRedditPostReference,
  findRedditShareUrl
} from '../actions/meme/reddit-post-client.js';

export type DirectMediaLinkKind = 'reddit' | 'instagram_reel';

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

  return null;
}
