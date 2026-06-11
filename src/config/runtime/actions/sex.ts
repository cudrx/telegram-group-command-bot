import { text } from '../../../locales/locale.js';

export const sexActionConfig = {
  subreddits: [
    'celebnsfw',
    'celebNSFWs',
    'LadyBoners', // straight women / male thirst
    'ladyladyboners',
    'NSFWfashion',
    'WatchItForThePlot'
  ],
  listing: {
    limit: 10,
    maxSourceAttempts: 3,
    minUpvotes: 10,
    timeRange: 'month'
  },
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
