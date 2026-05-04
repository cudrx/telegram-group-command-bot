import type Database from 'better-sqlite3';
import { stringifyJson, toStoredMediaArtifact } from './rows.js';
import type {
  SaveMediaArtifactInput,
  StoredMediaArtifact,
  StoredMediaArtifactRow
} from './types.js';

const MEDIA_ARTIFACT_SELECT_COLUMNS = `
  id,
  file_unique_id AS fileUniqueId,
  chat_id AS chatId,
  telegram_message_id AS telegramMessageId,
  media_kind AS mediaKind,
  provider,
  provider_model AS providerModel,
  artifact_kind AS artifactKind,
  artifact_status AS artifactStatus,
  artifact_text AS artifactText,
  artifact_json AS artifactJson,
  raw_response_json AS rawResponseJson,
  source_caption AS sourceCaption,
  source_mime_type AS sourceMimeType,
  source_file_size AS sourceFileSize,
  source_duration_seconds AS sourceDurationSeconds,
  recognition_language AS recognitionLanguage,
  confidence_json AS confidenceJson,
  error_text AS errorText,
  created_at AS createdAt,
  expires_at AS expiresAt
`;

export function saveMediaArtifact(
  db: Database.Database,
  input: SaveMediaArtifactInput
): void {
  db.prepare(
    `
      INSERT INTO media_artifacts (
        file_unique_id,
        chat_id,
        telegram_message_id,
        media_kind,
        provider,
        provider_model,
        artifact_kind,
        artifact_status,
        artifact_text,
        artifact_json,
        raw_response_json,
        source_caption,
        source_mime_type,
        source_file_size,
        source_duration_seconds,
        recognition_language,
        confidence_json,
        error_text,
        created_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    input.fileUniqueId,
    input.chatId,
    input.telegramMessageId,
    input.mediaKind,
    input.provider,
    input.providerModel,
    input.artifactKind,
    input.artifactStatus,
    input.artifactText,
    stringifyJson(input.artifactJson),
    stringifyJson(input.rawResponseJson),
    input.sourceCaption,
    input.sourceMimeType,
    input.sourceFileSize,
    input.sourceDurationSeconds,
    input.recognitionLanguage,
    stringifyJson(input.confidenceJson),
    input.errorText,
    input.createdAt,
    input.expiresAt
  );
}

export function getSuccessfulMediaArtifact(
  db: Database.Database,
  input: {
    fileUniqueId: string | null;
    chatId: number;
    telegramMessageId: number;
    provider: string;
    artifactKind: string;
  }
): StoredMediaArtifact | null {
  if (input.fileUniqueId) {
    const byFileUniqueId = getMediaArtifactRow(
      db,
      buildLatestArtifactByFileUniqueIdQuery({
        onlySuccessful: true
      }),
      [input.fileUniqueId, input.provider, input.artifactKind]
    );

    if (byFileUniqueId) {
      return byFileUniqueId;
    }
  }

  return getMediaArtifactRow(
    db,
    buildLatestArtifactByMessageQuery({
      onlySuccessful: true
    }),
    [input.chatId, input.telegramMessageId, input.provider, input.artifactKind]
  );
}

export function getLatestMediaArtifact(
  db: Database.Database,
  input: {
    fileUniqueId: string | null;
    chatId: number;
    telegramMessageId: number;
    provider: string;
    artifactKind: string;
  }
): StoredMediaArtifact | null {
  if (input.fileUniqueId) {
    const byFileUniqueId = getMediaArtifactRow(
      db,
      buildLatestArtifactByFileUniqueIdQuery({
        onlySuccessful: false
      }),
      [input.fileUniqueId, input.provider, input.artifactKind]
    );

    if (byFileUniqueId) {
      return byFileUniqueId;
    }
  }

  return getMediaArtifactRow(
    db,
    buildLatestArtifactByMessageQuery({
      onlySuccessful: false
    }),
    [input.chatId, input.telegramMessageId, input.provider, input.artifactKind]
  );
}

export function getSuccessfulMediaArtifactsForMessages(
  db: Database.Database,
  input: {
    chatId: number;
    messageIds: number[];
  }
): StoredMediaArtifact[] {
  if (input.messageIds.length === 0) {
    return [];
  }

  const placeholders = input.messageIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `
        SELECT
          ${MEDIA_ARTIFACT_SELECT_COLUMNS}
        FROM media_artifacts
        WHERE chat_id = ?
          AND telegram_message_id IN (${placeholders})
          AND artifact_status = 'success'
        ORDER BY telegram_message_id DESC, created_at DESC
      `
    )
    .all(input.chatId, ...input.messageIds) as StoredMediaArtifactRow[];

  return rows.map(toStoredMediaArtifact);
}

function getMediaArtifactRow(
  db: Database.Database,
  sql: string,
  params: unknown[]
): StoredMediaArtifact | null {
  const row = db.prepare(sql).get(...params) as
    | StoredMediaArtifactRow
    | undefined;
  return row ? toStoredMediaArtifact(row) : null;
}

function buildLatestArtifactByFileUniqueIdQuery(input: {
  onlySuccessful: boolean;
}): string {
  return `
    SELECT
      ${MEDIA_ARTIFACT_SELECT_COLUMNS}
    FROM media_artifacts
    WHERE file_unique_id = ?
      AND provider = ?
      AND artifact_kind = ?
      ${getArtifactStatusClause(input)}
    ORDER BY created_at DESC
    LIMIT 1
  `;
}

function buildLatestArtifactByMessageQuery(input: {
  onlySuccessful: boolean;
}): string {
  return `
    SELECT
      ${MEDIA_ARTIFACT_SELECT_COLUMNS}
    FROM media_artifacts
    WHERE chat_id = ?
      AND telegram_message_id = ?
      AND provider = ?
      AND artifact_kind = ?
      ${getArtifactStatusClause(input)}
    ORDER BY created_at DESC
    LIMIT 1
  `;
}

function getArtifactStatusClause(input: { onlySuccessful: boolean }): string {
  return input.onlySuccessful ? "AND artifact_status = 'success'" : '';
}
