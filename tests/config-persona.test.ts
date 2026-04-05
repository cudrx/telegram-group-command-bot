import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  getChatPersonaFilePath,
  loadPersona
} from "../src/config/persona.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadPersona", () => {
  test("falls back to the global persona when there is no chat override", async () => {
    const personaFile = createPersonaFixture({
      basePersona: "ты весёлый персонаж"
    });

    await expect(loadPersona(personaFile, 42)).resolves.toBe("ты весёлый персонаж");
  });

  test("appends chat-specific override when a chat persona file exists", async () => {
    const personaFile = createPersonaFixture({
      basePersona: "ты весёлый персонаж",
      chatId: 42,
      chatPersona: "в этом чате ты ведёшь себя как саркастичный футбольный фанат"
    });

    await expect(loadPersona(personaFile, 42)).resolves.toBe(
      [
        "ты весёлый персонаж",
        "",
        "Chat-specific persona override:",
        "в этом чате ты ведёшь себя как саркастичный футбольный фанат"
      ].join("\n")
    );
  });

  test("derives chat persona path next to the global persona", () => {
    expect(getChatPersonaFilePath("config/persona.md", -100123)).toBe(
      path.join("config", "personas", "-100123.md")
    );
  });
});

function createPersonaFixture(input: {
  basePersona: string;
  chatId?: number;
  chatPersona?: string;
}): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "chatbot-persona-"));
  const configDirectory = path.join(directory, "config");
  const personaFile = path.join(configDirectory, "persona.md");

  tempDirectories.push(directory);
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(personaFile, `${input.basePersona}\n`, "utf8");

  if (input.chatId !== undefined && input.chatPersona !== undefined) {
    const personasDirectory = path.join(configDirectory, "personas");

    mkdirSync(personasDirectory, { recursive: true });
    writeFileSync(
      path.join(personasDirectory, `${input.chatId}.md`),
      `${input.chatPersona}\n`,
      "utf8"
    );
  }

  return personaFile;
}
