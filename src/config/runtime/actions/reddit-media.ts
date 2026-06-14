import { text } from '../../../locales/locale.js';

const redditMediaSharedConfig = {
  listing: {
    limit: 10,
    maxSourceAttempts: 3,
    minUpvotes: 10,
    timeRange: 'month'
  },
  historyRetentionDays: 14,
  telegramMedia: {
    imageMaxBytes: 10_000_000,
    videoMaxBytes: 50_000_000, // Default Telegram Bot API upload limit for bot-sent video files.
    videoMaxDurationSeconds: 600,
    downloadTimeoutMs: 30_000
  },
  caption: {
    maxLength: 1024
  }
} as const;

export const redditMediaActionConfig = {
  ...redditMediaSharedConfig,
  presets: {
    meme: {
      fallbackText: text.meme.fallback,
      subreddits: [
        'BatmanArkham',
        'blursed_videos',
        'dankvideos',
        'discordVideos',
        'marvelcirclejerk',
        'MarvelRivalsCirclejer',
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
      ]
    },
    sex: {
      fallbackText: text.meme.fallback,
      subreddits: [
        'celebnsfw',
        'celebNSFWs',
        'LadyBoners', // straight women / male thirst
        'ladyladyboners',
        'NSFWfashion',
        'WatchItForThePlot'
      ]
    }
  }
} as const;

export const memeActionConfig = {
  ...redditMediaSharedConfig,
  ...redditMediaActionConfig.presets.meme
} as const;

export const sexActionConfig = {
  ...redditMediaSharedConfig,
  ...redditMediaActionConfig.presets.sex
} as const;
