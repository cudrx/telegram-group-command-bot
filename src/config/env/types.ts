export const CHAT_COMMANDS = [
  'translate',
  'read',
  'transcribe',
  'meme',
  'sex'
] as const;

export const CHAT_FEATURES = [
  'assistant',
  'direct_links',
  'deploy_announcements'
] as const;

export type ChatCommand = (typeof CHAT_COMMANDS)[number];
export type ChatFeature = (typeof CHAT_FEATURES)[number];
export type RedditCommandSource = Extract<ChatCommand, 'meme' | 'sex'>;

export type ChatPolicy = {
  chatId: number;
  label: string | null;
  commands: Record<ChatCommand, boolean>;
  features: Record<ChatFeature, boolean>;
  reddit_sources: Partial<Record<RedditCommandSource, string[]>>;
};

export type TelegramChatEnv = {
  telegramChatPolicies: ChatPolicy[];
  telegramAdminId: number;
  telegramLinkUserIds: number[];
};

export type ParsedEnv = {
  nodeEnv: 'development' | 'test' | 'production';
  telegramBotToken: string;
  llmApiKey: string;
  llmBaseUrl: string;
  llmReplyModel: string;
  llmReplyTemperature: number;
  llmTimeoutMs: number;
  llmMaxRetries: number;
  logLlmText: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logColor: boolean;
  sqlitePath: string;
  mediaVideoUrl: string | null;
  mediaGalleryUrl: string | null;
  redditCookieHeaderPath: string | null;
  redditCookiesPath: string | null;
  instagramCookiesPath: string | null;
  youtubeCookiesPath: string | null;
  answerContextLimit: number;
  replyMinTypingMs: number;
  replyMaxTypingMs: number;
  replyTypingRefreshMs: number;
  lookupProvider: 'deepseek' | 'tavily';
  deepseekApiKey: string | null;
  tavilyApiKey: string | null;
  lookupTimeoutMs: number;
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
  telegramAdminId: number;
  telegramLinkUserIds: number[];
};

export type AppEnv = ParsedEnv;
