const ALLOWED_TAGS = new Set(['b', 'i', 'code']);
const TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;
const MARKDOWN_AMP = '\uE000AMP\uE000';
const MARKDOWN_LT = '\uE000LT\uE000';
const MARKDOWN_GT = '\uE000GT\uE000';

type TelegramReplyIntent = 'summarize' | 'decide' | 'read' | 'answer';

export function formatTelegramHtmlReply(
  text: string,
  options: { intent?: TelegramReplyIntent } = {}
): string {
  return restoreMarkdownEscapes(
    sanitizeTelegramHtml(normalizeReplyText(text, options))
  );
}

function normalizeReplyText(
  text: string,
  options: { intent?: TelegramReplyIntent }
): string {
  const normalizedLines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => normalizeLine(line.trimEnd(), options))
    .filter((line) => line !== null);

  return normalizedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeLine(
  line: string,
  options: { intent?: TelegramReplyIntent }
): string | null {
  const bulletLine = normalizeBulletLine(line);

  if (options.intent === 'summarize') {
    const summarizeLine = normalizeSummarizeLine(bulletLine);

    if (summarizeLine === null) {
      return null;
    }

    return normalizeMarkdownLine(summarizeLine);
  }

  return normalizeMarkdownLine(bulletLine);
}

function normalizeBulletLine(line: string): string {
  return line.replace(/^\s*[-*]\s+/, '• ').replace(/^\s*•\s+/, '• ');
}

function normalizeSummarizeLine(line: string): string | null {
  if (/^\s*summary\s*:?\s*$/i.test(line)) {
    return null;
  }

  const finalLabelMatch = /^(?:•\s+)?(?:итог|summary)\s*:\s*(.+)$/i.exec(line);

  if (finalLabelMatch?.[1]) {
    return `<b>Итог</b> — ${lowercaseFirstLetter(finalLabelMatch[1].trim())}`;
  }

  return line;
}

function normalizeMarkdownLine(line: string): string {
  return line
    .replace(/\*\*([^*\n]+)\*\*/g, (_match, content: string) => {
      return `<b>${escapeMarkdownTagContent(content)}</b>`;
    })
    .replace(/`([^`\n]+)`/g, (_match, content: string) => {
      return `<code>${escapeMarkdownTagContent(content)}</code>`;
    });
}

function lowercaseFirstLetter(text: string): string {
  return text.replace(/^(\p{L})/u, (_match, first: string) =>
    first.toLocaleLowerCase('ru-RU')
  );
}

function escapeMarkdownTagContent(text: string): string {
  return text
    .replace(/&/g, MARKDOWN_AMP)
    .replace(/</g, MARKDOWN_LT)
    .replace(/>/g, MARKDOWN_GT);
}

function restoreMarkdownEscapes(text: string): string {
  return text
    .replaceAll(MARKDOWN_AMP, '&amp;')
    .replaceAll(MARKDOWN_LT, '&lt;')
    .replaceAll(MARKDOWN_GT, '&gt;');
}

function sanitizeTelegramHtml(text: string): string {
  const output: string[] = [];
  const openTags: string[] = [];
  let cursor = 0;

  for (
    let match = TAG_PATTERN.exec(text);
    match !== null;
    match = TAG_PATTERN.exec(text)
  ) {
    const tagToken = match[0];
    const tagStart = match.index ?? 0;

    output.push(escapeHtml(text.slice(cursor, tagStart)));
    appendSafeTag(tagToken, output, openTags);
    cursor = tagStart + tagToken.length;
  }

  output.push(escapeHtml(text.slice(cursor)));

  while (openTags.length > 0) {
    output.push(`</${openTags.pop()}>`);
  }

  return output.join('');
}

function appendSafeTag(
  tagToken: string,
  output: string[],
  openTags: string[]
): void {
  const closingMatch = /^<\s*\/\s*([a-zA-Z]+)\s*>$/.exec(tagToken);

  if (closingMatch) {
    const rawTagName = closingMatch[1];

    if (!rawTagName) {
      return;
    }

    const tagName = rawTagName.toLowerCase();

    if (ALLOWED_TAGS.has(tagName)) {
      closeTag(tagName, output, openTags);
    }

    return;
  }

  const openingMatch = /^<\s*([a-zA-Z]+)(?:\s+[^>]*)?\s*>$/.exec(tagToken);

  if (!openingMatch) {
    return;
  }

  const rawTagName = openingMatch[1];

  if (!rawTagName) {
    return;
  }

  const tagName = rawTagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tagName)) {
    return;
  }

  output.push(`<${tagName}>`);
  openTags.push(tagName);
}

function closeTag(tagName: string, output: string[], openTags: string[]): void {
  const existingIndex = openTags.lastIndexOf(tagName);

  if (existingIndex === -1) {
    return;
  }

  while (openTags.length > existingIndex) {
    output.push(`</${openTags.pop()}>`);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
