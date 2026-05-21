import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function readRedditCookieHeader(
  input:
    | string
    | {
        sqlitePath?: string | undefined;
        redditCookiesPath?: string | undefined;
      }
    | undefined
): Promise<string | null> {
  const cookiesPath = resolveRedditCookiesPath(input);
  if (!cookiesPath) return null;

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

function resolveRedditCookiesPath(
  input:
    | string
    | {
        sqlitePath?: string | undefined;
        redditCookiesPath?: string | undefined;
      }
    | undefined
): string | null {
  if (typeof input === 'string') {
    if (input === ':memory:') return null;

    return path.join(path.dirname(input), 'reddit-cookies.txt');
  }

  if (input?.redditCookiesPath) return input.redditCookiesPath;
  if (!input?.sqlitePath || input.sqlitePath === ':memory:') return null;

  return path.join(path.dirname(input.sqlitePath), 'reddit-cookies.txt');
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
