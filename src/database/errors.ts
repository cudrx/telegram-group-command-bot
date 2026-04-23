export function normalizeDatabaseOpenError(
  error: unknown,
  filename: string
): Error {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_CANTOPEN'
  ) {
    return new Error(`Could not open SQLite database at ${filename}`);
  }

  return error instanceof Error ? error : new Error(String(error));
}
