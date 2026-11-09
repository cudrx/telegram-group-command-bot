import { spontaneousConfig } from '../../config/runtime/spontaneous.js';

// A first-order word chain deliberately allows abrupt changes of meaning.
// Repeated transitions retain their frequency as weights.
export function generateMarkovDraft(
  samples: string[],
  random: () => number
): string | null {
  const starts: string[] = [];
  const transitions = new Map<string, Array<string | null>>();
  const originals = new Set(samples);
  for (const sample of samples) {
    const words = sample.split(/\s+/).filter(Boolean);
    if (words[0]) starts.push(words[0]);

    for (const [index, word] of words.entries()) {
      const choices = transitions.get(word) ?? [];
      choices.push(words[index + 1] ?? null);
      transitions.set(word, choices);
    }
  }
  if (starts.length === 0) return null;

  const limits = spontaneousConfig.generation;
  for (let attempt = 0; attempt < limits.attempts; attempt++) {
    const first = starts[Math.floor(random() * starts.length)];
    if (!first) continue;

    const result = [first];
    let current = first;
    while (result.length <= limits.maxWords) {
      const choices = transitions.get(current);
      if (!choices) break;

      const next = choices[Math.floor(random() * choices.length)];
      if (next == null) {
        const draft = result.join(' ');
        if (
          result.length >= limits.minWords &&
          result.length <= limits.maxWords &&
          draft.length <= limits.maxChars &&
          !originals.has(draft)
        )
          return draft;

        break;
      }
      result.push(next);
      current = next;
    }
  }

  return null;
}
