import type {
  ChatState,
  MediaMessageSnapshot,
  NormalizedMessage,
  StoredMessage
} from '../domain/models.js';

export type MediaArtifactStatus = 'success' | 'failed' | 'partial';

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

export type StoredMessageRow = Omit<StoredMessage, 'isBot'> & {
  isBot: number;
  mediaKind?: string | null;
  mediaFileId?: string | null;
  mediaFileUniqueId?: string | null;
  mediaMimeType?: string | null;
  mediaFileSize?: number | null;
  mediaDurationSeconds?: number | null;
  mediaCaption?: string | null;
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

export type {
  ChatState,
  MediaMessageSnapshot,
  NormalizedMessage,
  StoredMessage
};
