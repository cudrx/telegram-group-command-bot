import { readFile } from 'node:fs/promises';
import path from 'node:path';

const COOKIES_FILENAME = 'reddit-cookies.txt';

export async function readRedditCookieHeader(
  sqlitePath: string | undefined
): Promise<string | null> {
  if (!sqlitePath || sqlitePath === ':memory:') return null;

  const cookiesPath = path.join(path.dirname(sqlitePath), COOKIES_FILENAME);
  let contents: string;

  try {
    contents = await readFile(cookiesPath, 'utf8');
  } catch (error) {
    if (isFileNotFound(error)) {
      throw new Error(
        `Reddit cookies file is required for Reddit requests: ${cookiesPath}`
      );
    }

    throw error;
  }

  const cookies = contents
    .split(/\r?\n/u)
    .map(parseNetscapeCookieLine)
    .filter((cookie): cookie is string => Boolean(cookie));

  return cookies.length > 0 ? cookies.join('; ') : null;
}

function parseNetscapeCookieLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const normalized = trimmed.startsWith('#HttpOnly_')
    ? trimmed.slice('#HttpOnly_'.length)
    : trimmed;
  if (normalized.startsWith('#')) return null;

  const fields = normalized.split('\t');
  const name = fields[5];
  const value = fields[6];

  if (!name || value === undefined) return null;

  return `${name}=${value}`;
}

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
