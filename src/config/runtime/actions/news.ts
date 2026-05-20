export const newsActionConfig = {
  retentionDays: 7,
  fetchTimeoutMs: 15_000,
  maxResponseChars: 1_500_000,
  userAgent:
    'Mozilla/5.0 (compatible; TelegramNewsDigestBot/1.0; +https://t.me)',
  sources: [
    {
      slug: 'investblog_ru',
      handle: '@investblog_ru',
      label: 'InvestBlog',
      role: 'primary',
      importance: 'high',
      lookbackDays: 2,
      maxPostsPerDigest: 20,
      promptNote:
        'Частый, но важный источник; не терять инвестиционные, рыночные и макро-сигналы.'
    },
    {
      slug: 'auantonov',
      handle: '@auantonov',
      label: 'Antonov',
      role: 'rare-high-signal',
      importance: 'high',
      lookbackDays: 7,
      maxPostsPerDigest: 7,
      promptNote:
        'Редкий важный источник; каждый пост считать потенциально значимым сигналом.'
    },
    {
      slug: 'crimsondigest',
      handle: '@crimsondigest',
      label: 'Crimson Digest',
      role: 'rare-high-signal',
      importance: 'high',
      lookbackDays: 7,
      maxPostsPerDigest: 7,
      promptNote:
        'Редкий важный источник; каждый пост считать потенциально значимым сигналом.'
    },
    {
      slug: 'thedailyblogteam',
      handle: '@thedailyblogteam',
      label: 'DailyBlog',
      role: 'context',
      importance: 'normal',
      lookbackDays: 1,
      maxPostsPerDigest: 8,
      promptNote:
        'Новостной поток для фона; фильтровать шум и не приравнивать каждый пост к аналитическому сигналу.'
    }
  ]
} as const;
