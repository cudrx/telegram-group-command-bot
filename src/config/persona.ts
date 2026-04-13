import { readFile } from "node:fs/promises";

export async function loadPersona(filePath: string): Promise<string> {
  const persona = (await readFile(filePath, "utf8")).trim();

  if (persona.length === 0) {
    throw new Error(`Persona file is empty: ${filePath}`);
  }

  return persona;
}
