const ALLOWED_TAGS = new Set(['b', 'i', 'code']);
const TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;
const MARKDOWN_AMP = '\uE000AMP\uE000';
const MARKDOWN_LT = '\uE000LT\uE000';
const MARKDOWN_GT = '\uE000GT\uE000';

type TelegramReplyIntent =
  | 'summarize'
  | 'decide'
  | 'read'
  | 'answer'
  | 'translate'
  | 'news';

export function formatTelegramHtmlReply(
  text: string,
  options: { intent?: TelegramReplyIntent } = {}
): string {
  return restoreMarkdownEscapes(
    sanitizeTelegramHtml(normalizeTelegramReplyText(text, options))
  );
}

function normalizeTelegramReplyText(
  text: string,
  options: { intent?: TelegramReplyIntent }
): string {
  const lines = normalizeLineEndings(text)
    .split('\n')
    .map((line) => normalizeLineForTelegram(line.trimEnd(), options))
    .filter((line) => line !== null);

  return addIntentSpacing(lines, options)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeLineForTelegram(
  line: string,
  options: { intent?: TelegramReplyIntent }
): string | null {
  const commonLine = normalizeCommonLine(line);
  const intentLine = normalizeIntentLine(commonLine, options);

  if (intentLine === null) return null;

  return normalizeMarkdownLine(intentLine);
}

function normalizeCommonLine(line: string): string {
  return normalizeBulletLine(line);
}

function normalizeIntentLine(
  line: string,
  options: { intent?: TelegramReplyIntent }
): string | null {
  switch (options.intent) {
    case 'news':
      return normalizeNewsLine(line);
    case 'summarize':
      return normalizeSummarizeLine(line);
    default:
      return line;
  }
}

function addIntentSpacing(
  lines: string[],
  options: { intent?: TelegramReplyIntent }
): string[] {
  if (options.intent === 'news') {
    return addNewsSpacing(lines);
  }

  return lines;
}

function normalizeNewsLine(line: string): string {
  const headingMatch = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);

  if (headingMatch?.[1]) {
    return `<b>${escapeMarkdownTagContent(headingMatch[1].trim())}</b>`;
  }

  const sectionMatch = /^(\d+\.\s+\S.*)$/.exec(line);

  if (sectionMatch?.[1]) {
    return `<b>${escapeMarkdownTagContent(sectionMatch[1].trim())}</b>`;
  }

  const signalMatch = /^(Сигнал\s+\d+:\s*.+)$/iu.exec(line);

  if (signalMatch?.[1]) {
    return `<b>${escapeMarkdownTagContent(signalMatch[1].trim())}</b>`;
  }

  const labelMatch = /^\*{0,2}(Значение|Уверенность):\*{0,2}\s*(.*)$/iu.exec(
    line
  );

  if (labelMatch?.[1]) {
    const value = labelMatch[2]?.trim();
    const label = `<b>${escapeMarkdownTagContent(labelMatch[1])}:</b>`;

    return value ? `${label} ${value}` : label;
  }

  const finalLabelMatch =
    /^(Итог|Для РФ|Для гражданина РФ|Война|Следить дальше):\s*(.*)$/iu.exec(
      line
    );

  if (finalLabelMatch?.[1]) {
    const value = finalLabelMatch[2]?.trim();
    const label = `<b>${escapeMarkdownTagContent(finalLabelMatch[1])}:</b>`;
    const numberedList =
      finalLabelMatch[1].toLocaleLowerCase('ru-RU') === 'следить дальше'
        ? normalizeInlineNumberedList(value ?? '')
        : null;

    if (numberedList !== null) {
      return `${label}\n\n${numberedList}`;
    }

    return value ? `${label} ${value}` : label;
  }

  return line;
}

function normalizeInlineNumberedList(text: string): string | null {
  const items = Array.from(
    text.matchAll(/(?:^|;\s*)\d+\)\s*([^;]+?)(?=\s*;\s*\d+\)|$)/gu),
    (match) => match[1]?.trim()
  ).filter((item): item is string => Boolean(item));

  if (items.length < 2) {
    return null;
  }

  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function addNewsSpacing(lines: string[]): string[] {
  const output: string[] = [];

  for (const line of lines) {
    if (isNewsBlockLine(line) && output.at(-1) && output.at(-1) !== '') {
      output.push('');
    }

    output.push(line);

    if (isNewsBlockLine(line)) {
      output.push('');
    }
  }

  return output;
}

function isNewsBlockLine(line: string): boolean {
  return (
    /^<b>\d+\.\s+.+<\/b>$/u.test(line) ||
    /^<b>Сигнал\s+\d+:.+<\/b>$/iu.test(line) ||
    /^<b>(?:Значение|Уверенность|Итог|Для РФ|Для гражданина РФ|Война|Следить дальше):<\/b>/iu.test(
      line
    )
  );
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
