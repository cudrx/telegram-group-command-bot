import { createHash } from 'node:crypto';

import { parseTelegramChannelPosts } from './parser.js';
import type { NewsPost, NewsSourceConfig } from './types.js';

export async function fetchTelegramChannelPosts(input: {
  fetch: typeof fetch;
  source: NewsSourceConfig;
  now: string;
  timeoutMs: number;
  maxResponseChars: number;
  userAgent: string;
}): Promise<NewsPost[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await input.fetch(`https://t.me/s/${input.source.slug}`, {
      headers: {
        'user-agent': input.userAgent
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Telegram public page returned ${response.status} for ${input.source.slug}`
      );
    }

    const html = await response.text();

    if (html.length > input.maxResponseChars) {
      throw new Error(
        `Telegram public page for ${input.source.slug} exceeded ${input.maxResponseChars} characters`
      );
    }

    return parseTelegramChannelPosts(html, input.source.slug).map((post) => ({
      ...post,
      fetchedAt: input.now,
      contentHash: createNewsPostHash(post.text)
    }));
  } finally {
    clearTimeout(timeout);
  }
}

function createNewsPostHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
