import { text } from '../../../locales/locale.js';

export const memeActionConfig = {
  subreddits: [
    'BatmanArkham',
    'blursed_videos',
    'dankvideos',
    'marvelcirclejerk',
    'MarvelRivalsCirclejer',
    // 'nbacirclejerk',
    // 'okbuddychicanery',
    // 'okbuddycinephile',
    'OkBuddyFresca',
    'okbuddymimir',
    'okbuddyretard',
    'okbuddyviltrum',
    'PeopleFuckingDying',
    'perfectlycutscreams',
    'shitposting',
    'ShittyMovieDetails',
    'SipsTea',
    'soccercirclejerk',
    'TikTokCringe',
    'Unexpected',
    'WatchPeopleDieInside'
  ],
  listing: {
    limit: 10,
    maxSourceAttempts: 3,
    minUpvotes: 10,
    timeRange: 'week'
  },
  historyRetentionDays: 14,
  fallbackText: text.meme.fallback,
  media: {
    imageMaxBytes: 10_000_000,
    videoMaxBytes: 50_000_000,
    downloadTimeoutMs: 30_000
  },
  caption: {
    maxLength: 1024
  }
} as const;
