export type SpeechCleanupResult =
  | { ok: true; text: string }
  | {
      ok: false;
      reason:
        | 'empty'
        | 'length'
        | 'link'
        | 'mention'
        | 'code'
        | 'structured'
        | 'content_loss';
    };

export function normalizeSpeechText(
  input: string,
  maxCharacters: number
): SpeechCleanupResult {
  const original = input.trim();

  if (original.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  if (hasLink(original)) {
    return { ok: false, reason: 'link' };
  }

  if (hasCode(original)) {
    return { ok: false, reason: 'code' };
  }

  if (looksStructured(original)) {
    return { ok: false, reason: 'structured' };
  }

  const mentions = original.match(/(^|\s)@[A-Za-z0-9_]{2,}/gu) ?? [];

  if (mentions.length > 1) {
    return { ok: false, reason: 'mention' };
  }

  const text = decodeHtmlEntities(stripHtmlTags(original))
    .replace(/^@([A-Za-z0-9_]{2,})\b/u, '$1')
    .replace(/\s+/gu, ' ')
    .trim();

  if (text.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  if (text.length > maxCharacters) {
    return { ok: false, reason: 'length' };
  }

  const lossBaseline = decodeHtmlEntities(stripSimpleTelegramHtmlTags(original))
    .replace(/\s+/gu, ' ')
    .trim();

  if (text.length < Math.ceil(lossBaseline.length * 0.55)) {
    return { ok: false, reason: 'content_loss' };
  }

  return { ok: true, text };
}

function hasLink(value: string): boolean {
  return /https?:\/\/|www\.|t\.me\/|telegram\.me\//iu.test(value);
}

function hasCode(value: string): boolean {
  return /```|`[^`]+`|<code\b|<\/code>/iu.test(value);
}

function looksStructured(value: string): boolean {
  const lines = value.split(/\r?\n/u);

  if (lines.length > 3) {
    return true;
  }

  if (lines.some((line) => /^\s*(?:[-*•]|\d+[.)])\s+/u.test(line))) {
    return true;
  }

  if (/^\s*[{[][\s\S]*[}\]]\s*$/u.test(value)) {
    return true;
  }

  if (/\|.+\|/u.test(value)) {
    return true;
  }

  return false;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<\/?[^>]+>/gu, '');
}

function stripSimpleTelegramHtmlTags(value: string): string {
  return value.replace(/<\/?(?:b|strong|i|em|u|ins|s|strike|del)>/giu, '');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}
