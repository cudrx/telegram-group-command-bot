export function formatMemeCaption(input: {
  localizedTitle: string;
  subreddit: string;
  upvotes: number;
  maxLength: number;
}): string {
  const metadata = `r/${input.subreddit} · ${formatInteger(
    input.upvotes
  )} апвоутов`;
  const separator = '\n\n';
  const escapedMetadata = escapeHtml(metadata);
  const titleBudget = Math.max(
    0,
    input.maxLength - separator.length - escapedMetadata.length
  );
  const escapedTitle = truncateAndEscape(input.localizedTitle, titleBudget);

  return `${escapedTitle}${separator}${escapedMetadata}`.trim();
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0
  })
    .format(value)
    .replace(/\u00a0/g, ' ');
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
