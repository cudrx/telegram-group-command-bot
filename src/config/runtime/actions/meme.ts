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
    limit: 10,
    maxSourceAttempts: 3
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
