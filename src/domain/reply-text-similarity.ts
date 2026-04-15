export function normalizeReplyText(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MIN_SHORT_ANCHOR_LENGTH = 3;
const MAX_SHORT_ANCHOR_WORDS = 3;
const SHORT_ANCHOR_STOP_WORDS = new Set([
  "а",
  "в",
  "и",
  "к",
  "на",
  "не",
  "но",
  "ну",
  "о",
  "он",
  "с",
  "так",
  "там",
  "то",
  "ты",
  "у",
  "уже",
  "что",
  "это",
  "я"
]);

export function extractShortReplyAnchors(text: string): string[] {
  const words = normalizeReplyText(text).split(" ").filter(Boolean);
  const anchors = new Set<string>();

  for (let start = 0; start < words.length; start += 1) {
    for (let size = 1; size <= MAX_SHORT_ANCHOR_WORDS; size += 1) {
      const phraseWords = words.slice(start, start + size);

      if (phraseWords.length !== size) {
        continue;
      }

      const phrase = phraseWords.join(" ");

      if (isUsefulShortAnchor(phrase, phraseWords)) {
        anchors.add(phrase);
      }
    }
  }

  return Array.from(anchors).sort();
}

export function hasRepeatedShortReplyAnchor(input: {
  candidateText: string;
  recentTexts: string[];
  minOccurrences: number;
}): boolean {
  const candidateAnchors = new Set(extractShortReplyAnchors(input.candidateText));

  if (candidateAnchors.size === 0) {
    return false;
  }

  const counts = new Map<string, number>();

  for (const text of input.recentTexts) {
    const anchorsInText = new Set(extractShortReplyAnchors(text));

    for (const anchor of candidateAnchors) {
      if (anchorsInText.has(anchor)) {
        counts.set(anchor, (counts.get(anchor) ?? 0) + 1);
      }
    }
  }

  return Array.from(counts.values()).some((count) => count >= input.minOccurrences);
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

function isUsefulShortAnchor(phrase: string, words: string[]): boolean {
  if (phrase.length < MIN_SHORT_ANCHOR_LENGTH) {
    return false;
  }

  if (words.length === 1) {
    return !SHORT_ANCHOR_STOP_WORDS.has(phrase);
  }

  return words.some((word) => !SHORT_ANCHOR_STOP_WORDS.has(word));
}
