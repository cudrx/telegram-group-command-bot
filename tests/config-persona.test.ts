import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadPersona } from "../src/config/persona.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadPersona", () => {
  test("loads only the base persona file", async () => {
    const personaFile = createPersonaFixture("ты весёлый персонаж");

    await expect(loadPersona(personaFile)).resolves.toBe("ты весёлый персонаж");
  });

  test("rejects an empty base persona file", async () => {
    const personaFile = createPersonaFixture("");

    await expect(loadPersona(personaFile)).rejects.toThrow(/Persona file is empty/);
  });

  test("base persona keeps informal chat tone without confusing style labels", () => {
    const persona = readFileSync("config/persona.md", "utf8");

    expect(persona).not.toContain("щитпост");
    expect(persona).not.toContain("короткая дурь между своими");
    expect(persona).toContain("неформально");
    expect(persona).toContain("не вылизывай пунктуацию");
    expect(persona).not.toContain("хаос");
  });
});

function createPersonaFixture(basePersona: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "chatbot-persona-"));
  const personaFile = path.join(directory, "persona.md");

  tempDirectories.push(directory);
  writeFileSync(personaFile, `${basePersona}\n`, "utf8");

  return personaFile;
}
