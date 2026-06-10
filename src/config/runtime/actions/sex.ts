import { text } from '../../../locales/locale.js';

export const sexActionConfig = {
  subreddits: [
    'GoneMild',
    'braless',
    'underboob',
    'NSFWfashion',
    'pokies',
    'CelebNSFW',
    'LadyBoners' // straight women / male thirst
  ],
  listing: {
    limit: 10,
    maxSourceAttempts: 3,
    minUpvotes: 10,
    timeRange: 'week'
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
