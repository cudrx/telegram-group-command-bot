import { readFileSync } from 'node:fs';

export function loadPromptFile(filePath: string): string {
  const prompt = readFileSync(filePath, 'utf8').trim();

  if (prompt.length === 0) {
    throw new Error(`Prompt file is empty: ${filePath}`);
  }

  return prompt;
}
