import Database from 'better-sqlite3';

export function migrateExistingSchema(db: Database.Database): void {
  ensureColumn(db, 'messages', 'media_kind', 'TEXT');
  ensureColumn(db, 'messages', 'media_file_id', 'TEXT');
  ensureColumn(db, 'messages', 'media_file_unique_id', 'TEXT');
  ensureColumn(db, 'messages', 'media_mime_type', 'TEXT');
  ensureColumn(db, 'messages', 'media_file_size', 'INTEGER');
  ensureColumn(db, 'messages', 'media_duration_seconds', 'REAL');
  ensureColumn(db, 'messages', 'media_caption', 'TEXT');
  ensureColumn(db, 'messages', 'from_user_id', 'INTEGER');
  ensureColumn(db, 'messages', 'from_username', 'TEXT');
  ensureColumn(db, 'messages', 'from_first_name', 'TEXT');
  ensureColumn(db, 'messages', 'from_last_name', 'TEXT');
  ensureColumn(db, 'messages', 'from_display_name', 'TEXT');
}

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void {
  const columns = (
    db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
      name: string;
    }>
  ).map((column) => column.name);

  if (!columns.includes(columnName)) {
    db.prepare(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
    ).run();
  }
}
