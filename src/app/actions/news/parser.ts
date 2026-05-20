import type { ParsedTelegramPost } from './types.js';

const MESSAGE_START_PATTERN =
  /<div\b[^>]*class="[^"]*\btgme_widget_message\b[^"]*\bjs-widget_message\b[^"]*"[^>]*\bdata-post="([^"]+)"[^>]*>/g;

export function parseTelegramChannelPosts(
  html: string,
  sourceSlug: string
): ParsedTelegramPost[] {
  const posts: ParsedTelegramPost[] = [];
  const matches = [...html.matchAll(MESSAGE_START_PATTERN)];

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    if (!match) continue;

    const dataPost = match[1];
    const startIndex = match.index ?? 0;
    const nextIndex = matches[index + 1]?.index ?? html.length;
    const block = html.slice(startIndex, nextIndex);
    const parsed = parseDataPost(dataPost, sourceSlug);

    if (!parsed) continue;

    const publishedAt = /<time\b[^>]*\bdatetime="([^"]+)"/.exec(block)?.[1];
    const textHtml = extractMessageTextHtml(block);

    if (!publishedAt || !textHtml) continue;

    const text = normalizeHtmlText(textHtml);

    if (!text) continue;

    posts.push({
      sourceSlug,
      messageId: parsed.messageId,
      publishedAt,
      text,
      url: `https://t.me/${sourceSlug}/${parsed.messageId}`
    });
  }

  return posts.sort((left, right) => left.messageId - right.messageId);
}

function parseDataPost(
  dataPost: string | undefined,
  sourceSlug: string
): { messageId: number } | null {
  const match = new RegExp(`^${escapeRegExp(sourceSlug)}/(\\d+)$`).exec(
    dataPost ?? ''
  );

  if (!match?.[1]) return null;

  return { messageId: Number.parseInt(match[1], 10) };
}

function extractMessageTextHtml(block: string): string | null {
  const markerMatch =
    /<div\b[^>]*class="[^"]*\btgme_widget_message_text\b[^"]*\bjs-message_text\b[^"]*"[^>]*>/u.exec(
      block
    );

  if (!markerMatch || markerMatch.index === undefined) return null;

  const contentStart = markerMatch.index + markerMatch[0].length;
  let cursor = contentStart;
  let depth = 1;

  while (cursor < block.length) {
    const nextOpen = block.indexOf('<div', cursor);
    const nextClose = block.indexOf('</div>', cursor);

    if (nextClose === -1) return null;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      cursor = nextOpen + 4;
      continue;
    }

    depth--;

    if (depth === 0) {
      return block.slice(contentStart, nextClose);
    }

    cursor = nextClose + '</div>'.length;
  }

  return null;
}

function normalizeHtmlText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/giu, '\n')
      .replace(/<\/p\s*>/giu, '\n')
      .replace(/<[^>]+>/gu, '')
      .replace(/\u00a0/g, ' ')
  )
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
