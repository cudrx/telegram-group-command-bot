import path from 'node:path';
import { redditMediaActionConfig } from '../../../config/runtime/index.js';
import {
  execMediaFileDefault,
  MEDIA_EXEC_MAX_BUFFER,
  type MediaExecFile
} from '../../../media/exec.js';
import { resolveRuntimeFilePath } from './paths.js';
import { resolveRedditPostMedia } from './reddit-post-resolver.js';
import type { MemePostCandidate } from './types.js';

type RedditPostReference = {
  permalink: string;
  redditPostId: string;
  subreddit: string;
};

export function findRedditPostReference(
  text: string
): RedditPostReference | null {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];

  for (const match of matches) {
    const parsed = parseRedditPostUrl(match);

    if (parsed) return parsed;
  }

  return null;
}

export async function resolveRedditPostWithGalleryDl(input: {
  text: string;
  sqlitePath: string;
  redditCookiesPath?: string | null | undefined;
  execFile?: MediaExecFile | undefined;
}): Promise<MemePostCandidate | null> {
  const sourceUrl =
    findRedditPostReference(input.text)?.permalink ??
    findRedditShareUrl(input.text);
  if (!sourceUrl) return null;

  const cookiesPath = resolveRuntimeFilePath(
    input.redditCookiesPath ??
      path.join(path.dirname(input.sqlitePath), 'reddit-cookies.txt')
  );
  const execFile = input.execFile ?? execMediaFileDefault;
  const result = await execFile(
    'gallery-dl',
    ['--cookies', cookiesPath, '--resolve-json', sourceUrl],
    {
      maxBuffer: MEDIA_EXEC_MAX_BUFFER,
      timeoutMs: redditMediaActionConfig.telegramMedia.metadataTimeoutMs
    }
  );
  const payload = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error('gallery-dl returned invalid Reddit metadata');
  }

  for (const row of payload) {
    if (!Array.isArray(row) || row[0] !== 2 || !isRecord(row[1])) continue;
    if (typeof row[1].id !== 'string' || typeof row[1].subreddit !== 'string')
      continue;

    return resolveRedditPostMedia(row[1]);
  }

  throw new Error('gallery-dl did not return Reddit post metadata');
}

export function findRedditShareUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];

  for (const match of matches) {
    const parsed = parseRedditShareUrl(match);

    if (parsed) return parsed;
  }

  return null;
}

function parseRedditShareUrl(value: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(stripTrailingPunctuation(value));
  } catch {
    return null;
  }

  if (!isRedditHost(parsed.hostname)) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  const subredditIndex = parts.findIndex((part) => part.toLowerCase() === 'r');

  if (
    subredditIndex < 0 ||
    parts[subredditIndex + 1] === undefined ||
    parts[subredditIndex + 2]?.toLowerCase() !== 's' ||
    parts[subredditIndex + 3] === undefined
  ) {
    return null;
  }

  parsed.hash = '';

  return parsed.toString();
}

function parseRedditPostUrl(value: string): RedditPostReference | null {
  let parsed: URL;

  try {
    parsed = new URL(stripTrailingPunctuation(value));
  } catch {
    return null;
  }

  if (!isRedditHost(parsed.hostname)) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  const subredditIndex = parts.findIndex((part) => part.toLowerCase() === 'r');

  if (
    subredditIndex < 0 ||
    parts[subredditIndex + 1] === undefined ||
    parts[subredditIndex + 2]?.toLowerCase() !== 'comments' ||
    parts[subredditIndex + 3] === undefined
  ) {
    return null;
  }

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = `/${parts.slice(0, subredditIndex + 5).join('/')}`;

  return {
    permalink: `${parsed.toString().replace(/\/$/, '')}/`,
    redditPostId: parts[subredditIndex + 3] as string,
    subreddit: parts[subredditIndex + 1] as string
  };
}

function isRedditHost(hostname: string): boolean {
  return hostname === 'reddit.com' || hostname.endsWith('.reddit.com');
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.]+$/u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
