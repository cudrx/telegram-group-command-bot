import type { MediaMessageSnapshot, StoredMessage } from '../domain/models.js';
import type {
  MediaArtifactStatus,
  StoredMediaArtifact,
  StoredMediaArtifactRow,
  StoredMessageRow
} from './types.js';

export function toStoredMessage(row: StoredMessageRow): StoredMessage {
  return {
    chatId: row.chatId,
    messageId: row.messageId,
    mediaGroupId: row.mediaGroupId ?? null,
    userId: row.userId,
    senderDisplayName: row.senderDisplayName,
    text: row.text,
    createdAt: row.createdAt,
    isBot: Boolean(row.isBot),
    replyToMessageId: row.replyToMessageId,
    mediaSnapshot:
      row.mediaKind && row.mediaFileId
        ? ({
            messageId: row.messageId,
            mediaKind: row.mediaKind,
            fileId: row.mediaFileId,
            fileUniqueId: row.mediaFileUniqueId ?? null,
            mimeType: row.mediaMimeType ?? null,
            fileSize: row.mediaFileSize ?? null,
            durationSeconds: row.mediaDurationSeconds ?? null,
            caption: row.mediaCaption ?? null
          } as MediaMessageSnapshot)
        : null
  };
}

export function stringifyJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseJsonColumn(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function toStoredMediaArtifact(
  row: StoredMediaArtifactRow
): StoredMediaArtifact {
  return {
    ...row,
    artifactStatus: row.artifactStatus as MediaArtifactStatus,
    artifactJson: parseJsonColumn(row.artifactJson),
    rawResponseJson: parseJsonColumn(row.rawResponseJson),
    confidenceJson: parseJsonColumn(row.confidenceJson)
  };
}
