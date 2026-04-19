import { readFile } from 'node:fs/promises';

export async function loadAssistantInstructions(
  filePath: string
): Promise<string> {
  const assistantInstructions = (await readFile(filePath, 'utf8')).trim();

  if (assistantInstructions.length === 0) {
    throw new Error(`Assistant instructions file is empty: ${filePath}`);
  }

  return assistantInstructions;
}
