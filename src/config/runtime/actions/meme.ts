export const memeActionConfig = {
  subreddits: [
    'BatmanArkham',
    // 'blursed_videos',
    // 'dankvideos',
    'hmm',
    'marvelcirclejerk',
    'MarvelRivalsCirclejer',
    // 'nbacirclejerk',
    'okbuddychicanery',
    'okbuddycinephile',
    'OkBuddyFresca',
    'okbuddymimir',
    'okbuddyretard',
    'okbuddyviltrum',
    // 'PeopleFuckingDying',
    // 'perfectlycutscreams',
    'shitposting',
    'ShittyMovieDetails',
    // 'SipsTea',
    'soccercirclejerk'
    // 'TikTokCringe',
    // 'Unexpected',
    // 'WatchPeopleDieInside'
  ],
  listing: {
    limit: 10,
    maxSourceAttempts: 3,
    minUpvotes: 10
  },
  historyRetentionDays: 14,
  fallbackText: 'Мемы закончились, идите трогайте траву.',
  source: {
    baseUrl: 'https://meme-api.com/gimme'
  },
  media: {
    imageMaxBytes: 10_000_000,
    animationMaxBytes: 45_000_000,
    downloadTimeoutMs: 30_000
  },
  caption: {
    maxLength: 1024
  }
} as const;
