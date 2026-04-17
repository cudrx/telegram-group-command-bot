const ALLOWED_TAGS = new Set(["b", "i", "code"]);
const TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;

export function formatTelegramHtmlReply(text: string): string {
  return sanitizeTelegramHtml(normalizeReplyText(text));
}

function normalizeReplyText(text: string): string {
  const normalizedLines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeBulletLine(line.trimEnd()));

  return normalizedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeBulletLine(line: string): string {
  return line
    .replace(/^\s*[-*]\s+/, "• ")
    .replace(/^\s*•\s+/, "• ");
}

function sanitizeTelegramHtml(text: string): string {
  const output: string[] = [];
  const openTags: string[] = [];
  let cursor = 0;

  for (let match = TAG_PATTERN.exec(text); match !== null; match = TAG_PATTERN.exec(text)) {
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

  return output.join("");
}

function appendSafeTag(tagToken: string, output: string[], openTags: string[]): void {
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
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
