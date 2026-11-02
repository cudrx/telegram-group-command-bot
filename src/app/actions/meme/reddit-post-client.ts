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
