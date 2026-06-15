import type Database from 'better-sqlite3';

import type {
  SourceStateKey,
  SourceStateStatus,
  StoredSourceState,
  StoredSourceStateRow
} from './types.js';

export function getSourceState(
  db: Database.Database,
  sourceKey: SourceStateKey
): StoredSourceState | null {
  const row = db
    .prepare(
      `
        SELECT
          source_key AS sourceKey,
          state,
          reason,
          blocked_at AS blockedAt,
          cookie_file_mtime_ms_at_block AS cookieFileMtimeMsAtBlock,
          updated_at AS updatedAt
        FROM source_states
        WHERE source_key = ?
      `
    )
    .get(sourceKey) as StoredSourceStateRow | undefined;

  return row ? toStoredSourceState(row) : null;
}

export function saveSourceState(
  db: Database.Database,
  input: {
    sourceKey: SourceStateKey;
    state: SourceStateStatus;
    reason: string | null;
    blockedAt: string | null;
    cookieFileMtimeMsAtBlock: number | null;
    updatedAt: string;
  }
): void {
  db.prepare(
    `
      INSERT INTO source_states (
        source_key,
        state,
        reason,
        blocked_at,
        cookie_file_mtime_ms_at_block,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        state = excluded.state,
        reason = excluded.reason,
        blocked_at = excluded.blocked_at,
        cookie_file_mtime_ms_at_block = excluded.cookie_file_mtime_ms_at_block,
        updated_at = excluded.updated_at
    `
  ).run(
    input.sourceKey,
    input.state,
    input.reason,
    input.blockedAt,
    input.cookieFileMtimeMsAtBlock,
    input.updatedAt
  );
}

function toStoredSourceState(row: StoredSourceStateRow): StoredSourceState {
  return {
    sourceKey: row.sourceKey as SourceStateKey,
    state: row.state as SourceStateStatus,
    reason: row.reason,
    blockedAt: row.blockedAt,
    cookieFileMtimeMsAtBlock: row.cookieFileMtimeMsAtBlock,
    updatedAt: row.updatedAt
  };
}
