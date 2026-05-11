export const memeActionConfig = {
  subreddits: [
    'blursed_videos',
    'dankvideos',
    'hmm',
    'marvelcirclejerk',
    'nbacirclejerk',
    'okbuddychicanery',
    'okbuddycinephile',
    'OkBuddyFresca',
    'okbuddymimir',
    'okbuddyretard',
    'okbuddyviltrum',
    'PeopleFuckingDying',
    'perfectlycutscreams',
    'shitposting',
    'ShittyMovieDetails',
    'SipsTea',
    'TikTokCringe',
    'Unexpected',
    'WatchPeopleDieInside'
  ],
  listing: {
    timeRange: 'week',
    limit: 10,
    maxSourceAttempts: 3
  },
  historyRetentionDays: 14,
  fallbackText: 'Мемы закончились, идите трогайте траву.',
  reddit: {
    listingUrlBase: 'https://www.reddit.com/r',
    userAgent: 'test-chatbot/0.1 meme command'
  },
  media: {
    imageMaxBytes: 10_000_000,
    galleryItemMaxBytes: 10_000_000,
    galleryTotalMaxBytes: 40_000_000,
    videoMaxBytes: 45_000_000,
    animationMaxBytes: 45_000_000,
    downloadTimeoutMs: 30_000,
    maxGalleryItems: 10
  },
  caption: {
    maxLength: 1024
  }
} as const;
