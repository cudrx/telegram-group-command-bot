import { access, readFile } from "node:fs/promises";
import path from "node:path";

export async function loadPersona(
  filePath: string,
  chatId?: number
): Promise<string> {
  const basePersona = await readRequiredPersona(filePath);

  if (chatId === undefined) {
    return basePersona;
  }

  const chatPersonaPath = getChatPersonaFilePath(filePath, chatId);
  const chatPersona = await readOptionalPersona(chatPersonaPath);

  if (chatPersona === null) {
    return basePersona;
  }

  return [
    basePersona,
    "",
    "Chat-specific persona override:",
    chatPersona
  ].join("\n");
}

export function getChatPersonaFilePath(
  filePath: string,
  chatId: number
): string {
  const extension = path.extname(filePath) || ".md";

  return path.join(path.dirname(filePath), "personas", `${chatId}${extension}`);
}

async function readRequiredPersona(filePath: string): Promise<string> {
  const persona = (await readFile(filePath, "utf8")).trim();

  if (persona.length === 0) {
    throw new Error(`Persona file is empty: ${filePath}`);
  }

  return persona;
}

async function readOptionalPersona(filePath: string): Promise<string | null> {
  try {
    await access(filePath);
  } catch {
    return null;
  }

  const persona = (await readFile(filePath, "utf8")).trim();

  if (persona.length === 0) {
    throw new Error(`Chat-specific persona file is empty: ${filePath}`);
  }

  return persona;
}
