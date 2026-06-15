import type {
  BotOutputMode,
  ChatState,
  MediaMessageSnapshot,
  NormalizedMessage,
  StoredMessage
} from '../domain/models.js';

export type MediaArtifactStatus = 'success' | 'failed' | 'partial';

export type MemeMediaKind = 'image' | 'video' | 'gallery';
export type SourceStateKey = 'instagram';
export type SourceStateStatus = 'healthy' | 'blocked';

export type SaveMediaArtifactInput = {
  fileUniqueId: string | null;
  chatId: number;
  telegramMessageId: number;
  mediaKind: string;
  provider: string;
  providerModel: string;
  artifactKind: string;
  artifactStatus: MediaArtifactStatus;
  artifactText: string | null;
  artifactJson: unknown;
  rawResponseJson: unknown;
  sourceCaption: string | null;
  sourceMimeType: string | null;
  sourceFileSize: number | null;
  sourceDurationSeconds: number | null;
  recognitionLanguage: string | null;
  confidenceJson: unknown;
  errorText: string | null;
  createdAt: string;
  expiresAt: string;
};

export type SaveMemePostInput = {
  chatId: number;
  redditPostId: string;
  subreddit: string;
  telegramMessageId: number | null;
  title: string;
  permalink: string;
  mediaKind: MemeMediaKind;
  mediaUrl: string | null;
  upvotes: number;
  sentAt: string;
};

export type StoredMediaArtifact = {
  id: number;
  fileUniqueId: string | null;
  chatId: number;
  telegramMessageId: number;
  mediaKind: string;
  provider: string;
  providerModel: string;
  artifactKind: string;
  artifactStatus: MediaArtifactStatus;
  artifactText: string | null;
  artifactJson: unknown;
  rawResponseJson: unknown;
  sourceCaption: string | null;
  sourceMimeType: string | null;
  sourceFileSize: number | null;
  sourceDurationSeconds: number | null;
  recognitionLanguage: string | null;
  confidenceJson: unknown;
  errorText: string | null;
  createdAt: string;
  expiresAt: string;
};

export type StoredSourceState = {
  sourceKey: SourceStateKey;
  state: SourceStateStatus;
  reason: string | null;
  blockedAt: string | null;
  cookieFileMtimeMsAtBlock: number | null;
  updatedAt: string;
};

export type StoredMessageRow = Omit<StoredMessage, 'isBot'> & {
  isBot: number;
  outputMode?: string | null;
  editedAt?: string | null;
  mediaKind?: string | null;
  mediaFileId?: string | null;
  mediaFileUniqueId?: string | null;
  mediaMimeType?: string | null;
  mediaFileSize?: number | null;
  mediaDurationSeconds?: number | null;
  mediaCaption?: string | null;
  mediaGroupId?: string | null;
};

export type UpdateChatTtsStateInput = {
  chatId: number;
  answerLastOutputMode?: BotOutputMode | null;
  answerEligibleTextSinceVoice?: number;
  answerEligibleTextStreak?: number;
  readLastVoiceAt?: string | null;
  readTtsVoiceCount?: number;
};

export type StoredMediaArtifactRow = {
  id: number;
  fileUniqueId: string | null;
  chatId: number;
  telegramMessageId: number;
  mediaKind: string;
  provider: string;
  providerModel: string;
  artifactKind: string;
  artifactStatus: string;
  artifactText: string | null;
  artifactJson: string | null;
  rawResponseJson: string | null;
  sourceCaption: string | null;
  sourceMimeType: string | null;
  sourceFileSize: number | null;
  sourceDurationSeconds: number | null;
  recognitionLanguage: string | null;
  confidenceJson: string | null;
  errorText: string | null;
  createdAt: string;
  expiresAt: string;
};

export type StoredSourceStateRow = {
  sourceKey: string;
  state: string;
  reason: string | null;
  blockedAt: string | null;
  cookieFileMtimeMsAtBlock: number | null;
  updatedAt: string;
};

export type {
  BotOutputMode,
  ChatState,
  MediaMessageSnapshot,
  NormalizedMessage,
  StoredMessage
};
