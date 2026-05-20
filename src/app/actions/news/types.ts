export type NewsSourceRole = 'primary' | 'rare-high-signal' | 'context';
export type NewsSourceImportance = 'high' | 'normal' | 'low';

export type NewsSourceConfig = {
  slug: string;
  handle: string;
  label: string;
  role: NewsSourceRole;
  importance: NewsSourceImportance;
  lookbackDays: number;
  maxPostsPerDigest: number;
  promptNote: string;
};

export type NewsPost = {
  sourceSlug: string;
  messageId: number;
  publishedAt: string;
  fetchedAt: string;
  text: string;
  url: string;
  contentHash: string;
};

export type ParsedTelegramPost = Omit<NewsPost, 'fetchedAt' | 'contentHash'>;

export type NewsSelection = {
  bySource: Map<string, NewsPost[]>;
  analysisPeriod: string;
  selectedPosts: NewsPost[];
};
