export function normalizeReplyText(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isNearDuplicateReplyText(left: string, right: string): boolean {
  const normalizedLeft = normalizeReplyText(left);
  const normalizedRight = normalizeReplyText(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftWords = new Set(normalizedLeft.split(" "));
  const rightWords = new Set(normalizedRight.split(" "));
  const intersectionSize = Array.from(leftWords).filter((word) => rightWords.has(word)).length;
  const unionSize = new Set([...leftWords, ...rightWords]).size;

  if (unionSize === 0) {
    return false;
  }

  return intersectionSize / unionSize >= 0.86 && Math.min(leftWords.size, rightWords.size) >= 5;
}
