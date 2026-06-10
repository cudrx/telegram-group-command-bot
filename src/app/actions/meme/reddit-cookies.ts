import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function readRedditCookieHeader(
  input:
    | string
    | {
        redditCookieHeaderPath?: string | null | undefined;
        sqlitePath?: string | undefined;
        redditCookiesPath?: string | null | undefined;
      }
    | undefined
): Promise<string | null> {
  const cookieHeaderPath =
    typeof input === 'string' ? null : input?.redditCookieHeaderPath;

  if (cookieHeaderPath) {
    return readRedditCookieHeaderFile(cookieHeaderPath);
  }

  const cookiesPath = resolveRedditCookiesPath(input);
  if (!cookiesPath) return null;

  const contents = await readRequiredFile(
    cookiesPath,
    `Reddit cookies file is required for Reddit requests: ${cookiesPath}`
  );

  const cookies = contents
    .split(/\r?\n/u)
    .map(parseNetscapeCookieLine)
    .filter((cookie): cookie is string => Boolean(cookie));

  return cookies.length > 0 ? cookies.join('; ') : null;
}

async function readRedditCookieHeaderFile(
  path: string
): Promise<string | null> {
  const contents = await readRequiredFile(
    path,
    `Reddit cookie header file is required for Reddit requests: ${path}`
  );
  const normalized = contents.trim();

  return normalized.length > 0 ? normalized : null;
}

async function readRequiredFile(
  path: string,
  missingFileMessage: string
): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isFileNotFound(error)) {
      throw new Error(missingFileMessage);
    }

    throw error;
  }
}

function resolveRedditCookiesPath(
  input:
    | string
    | {
        redditCookieHeaderPath?: string | null | undefined;
        sqlitePath?: string | undefined;
        redditCookiesPath?: string | null | undefined;
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
