export const llmProviderConfig = {
  genericDefaults: {
    baseUrl: 'https://api.deepseek.com',
    replyModel: 'deepseek-v4-flash',
    replyTemperature: 0.6,
    timeoutMs: 45_000,
    maxRetries: 1
  },
  legacyQwenDefaults: {
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    replyModel: 'qwen-plus',
    replyTemperature: '0.6',
    timeoutMs: '20000',
    maxRetries: '1'
  },
  lookupPlanner: {
    temperature: 0,
    maxTokens: 500
  },
  deployUpdate: {
    temperature: 0.4,
    maxTokens: 500
  }
} as const;
