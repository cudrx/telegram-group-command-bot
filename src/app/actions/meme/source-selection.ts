export interface SelectMemeSourcesInput {
  subreddits: readonly string[];
  maxSourceAttempts: number;
  random: () => number;
}

export function selectMemeSources({
  subreddits,
  maxSourceAttempts,
  random
}: SelectMemeSourcesInput): string[] {
  const uniqueSubreddits = Array.from(new Set(subreddits));
  const shuffled = [...uniqueSubreddits];

  for (let index = 0; index < shuffled.length - 1; index += 1) {
    const remaining = shuffled.length - index;
    const swapIndex = index + Math.floor(random() * remaining);
    const current = shuffled[index];
    const target = shuffled[swapIndex];
    if (current === undefined || target === undefined) continue;

    shuffled[index] = target;
    shuffled[swapIndex] = current;
  }

  return shuffled.slice(0, Math.max(0, maxSourceAttempts));
}
