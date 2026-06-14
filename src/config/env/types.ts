export const CHAT_FEATURES = [
  'answer',
  'summarize',
  'decide',
  'translate',
  'read',
  'transcribe',
  'meme',
  'sex',
  'direct_links'
] as const;

export type ChatFeature = (typeof CHAT_FEATURES)[number];

export type ChatPolicy = {
  chatId: number;
  label: string | null;
  features: Record<ChatFeature, boolean>;
};

export type TelegramChatEnv = {
  telegramChatPolicies: ChatPolicy[];
  telegramAdminDefaultChatId: number | null;
  telegramAdminId: number;
  telegramLinkUserIds: number[];
};

export type ParsedEnv = {
  nodeEnv: 'development' | 'test' | 'production';
  telegramBotToken: string;
  llmApiKey: string;
  llmBaseUrl: string;
  llmReplyModel: string;
  llmPlannerModel: string;
  llmReplyTemperature: number;
  llmTimeoutMs: number;
  llmMaxRetries: number;
  logLlmText: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logColor: boolean;
  sqlitePath: string;
  redditCookieHeaderPath: string | null;
  redditCookiesPath: string | null;
  instagramCookiesPath: string | null;
  youtubeCookiesPath: string | null;
  answerContextLimit: number;
  summarizeContextLimit: number;
  decideContextLimit: number;
  replyMinTypingMs: number;
  replyMaxTypingMs: number;
  replyTypingRefreshMs: number;
  lookupProvider: 'tavily';
  tavilyApiKey: string | null;
  lookupTimeoutMs: number;
  lookupMaxQueries: number;
  lookupMaxResults: number;
  ocrSpaceApiKey: string | null;
  sttProvider: 'gladia';
  gladiaApiKey: string | null;
  yandexSpeechKitApiKey: string | null;
  visionProvider: 'cloudflare';
  cloudflareAiApiKey: string | null;
  cloudflareAccountId: string | null;
  mediaMaxFileBytes: number;
  mediaArtifactRetentionDays: number;
  memeHistoryRetentionDays: number;
  messageRetentionDays: number;
  databaseCleanupIntervalHours: number;
  telegramChatPolicies: ChatPolicy[];
  telegramAdminDefaultChatId: number | null;
  telegramAdminId: number;
  telegramLinkUserIds: number[];
};

export type AppEnv = ParsedEnv;
