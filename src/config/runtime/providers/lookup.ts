export const lookupProviderConfig = {
  provider: 'tavily',
  tavily: {
    endpoint: 'https://api.tavily.com/search',
    searchDepth: 'basic',
    includeAnswer: false,
    includeRawContent: false,
    includeUsage: true
  },
  defaults: {
    timeoutMs: 7000,
    maxQueries: 1,
    maxResults: 3
  }
} as const;
