export const MARKDOWN_AMP = '\uE000AMP\uE000';
export const MARKDOWN_LT = '\uE000LT\uE000';
export const MARKDOWN_GT = '\uE000GT\uE000';

export function escapeMarkdownTagContent(text: string): string {
  return text
    .replace(/&/g, MARKDOWN_AMP)
    .replace(/</g, MARKDOWN_LT)
    .replace(/>/g, MARKDOWN_GT);
}

export function restoreMarkdownEscapes(text: string): string {
  return text
    .replaceAll(MARKDOWN_AMP, '&amp;')
    .replaceAll(MARKDOWN_LT, '&lt;')
    .replaceAll(MARKDOWN_GT, '&gt;');
}
