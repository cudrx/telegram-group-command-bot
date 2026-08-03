export type DirectMediaAuthor = {
  chatType: string;
  fromUserId: number | null;
  fromUsername: string | null;
  fromDisplayName: string;
};

export function appendDirectMediaAuthor(
  caption: string,
  author: DirectMediaAuthor
): string {
  if (author.chatType !== 'group' && author.chatType !== 'supergroup') {
    return caption;
  }

  return `${caption} · ${formatDirectMediaAuthor(author)}`;
}

export function formatDirectMediaAuthor(author: DirectMediaAuthor): string {
  if (author.fromUsername) {
    const username = author.fromUsername.replace(/^@/u, '');

    return `<a href="https://t.me/${escapeAttribute(username)}">@${escapeHtml(username)}</a>`;
  }

  const displayName = escapeHtml(author.fromDisplayName);
  if (author.fromUserId === null) return displayName;

  return `<a href="tg://user?id=${author.fromUserId}">${displayName}</a>`;
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
