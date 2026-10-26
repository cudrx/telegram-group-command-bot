export type LookupSource = {
  title: string;
  url: string;
  content: string;
  score: number | null;
};

export type LookupProviderSearchInput = {
  query: string;
  maxResults: number;
  timeoutMs: number;
};

export type LookupProviderSearchResult = {
  provider: 'deepseek' | 'tavily';
  query: string;
  sources: LookupSource[];
  responseTimeMs: number | null;
  usageCredits: number | null;
};

export type LookupProvider = {
  search(input: LookupProviderSearchInput): Promise<LookupProviderSearchResult>;
};
