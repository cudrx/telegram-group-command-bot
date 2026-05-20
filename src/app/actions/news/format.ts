import { escapeMarkdownTagContent } from '../../telegram-html/escapes.js';

export function normalizeNewsLine(line: string): string {
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

export function addNewsSpacing(lines: string[]): string[] {
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

function isNewsBlockLine(line: string): boolean {
  return (
    /^<b>\d+\.\s+.+<\/b>$/u.test(line) ||
    /^<b>Сигнал\s+\d+:.+<\/b>$/iu.test(line) ||
    /^<b>(?:Значение|Уверенность|Итог|Для РФ|Для гражданина РФ|Война|Следить дальше):<\/b>/iu.test(
      line
    )
  );
}
