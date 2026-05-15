export function formatMemeCaption(input: {
  title: string;
  subreddit: string;
  upvotes: number;
  permalink: string;
  maxLength: number;
}): string {
  const metadata = `r/${input.subreddit} · <a href="${escapeAttribute(
    input.permalink
  )}">↑${formatInteger(input.upvotes)}</a>`;
  const separator = '\n\n';
  const titleBudget = Math.max(
    0,
    input.maxLength - separator.length - metadata.length
  );
  const escapedTitle = truncateAndEscape(input.title, titleBudget);

  return `${escapedTitle}${separator}${metadata}`.trim();
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0
  })
    .format(value)
    .replace(/\u00a0/g, '');
}

function truncateAndEscape(value: string, maxEscapedLength: number): string {
  const trimmed = value.trim();
  if (escapeHtml(trimmed).length <= maxEscapedLength) {
    return escapeHtml(trimmed);
  }

  if (maxEscapedLength <= 0) {
    return '';
  }

  let truncated = '';
  for (const character of trimmed) {
    const candidate = `${truncated}${character}`;
    const escapedCandidate = escapeHtml(`${candidate.trimEnd()}…`);
    if (escapedCandidate.length > maxEscapedLength) {
      break;
    }

    truncated = candidate;
  }

  if (!truncated && maxEscapedLength >= '…'.length) {
    return '…';
  }

  return escapeHtml(`${truncated.trimEnd()}…`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
