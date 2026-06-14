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
      subreddits: [] as const
    },
    sex: {
      fallbackText: text.meme.fallback,
      subreddits: [] as const
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
