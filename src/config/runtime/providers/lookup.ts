export const lookupProviderConfig = {
  provider: 'deepseek',
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1/tools/search',
    maxQueryChars: 128
  },
  tavily: {
    endpoint: 'https://api.tavily.com/search',
    searchDepth: 'basic',
    includeAnswer: false,
    includeRawContent: false,
    includeUsage: true
  },
  defaults: {
    timeoutMs: 7000,
    maxResults: 3
  }
} as const;
