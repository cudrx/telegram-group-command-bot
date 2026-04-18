import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadAssistantInstructions } from "../src/config/assistant-instructions.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadAssistantInstructions", () => {
  test("loads the assistant instructions file", async () => {
    const instructionsFile = createInstructionsFixture("нейтральные инструкции");

    await expect(loadAssistantInstructions(instructionsFile)).resolves.toBe("нейтральные инструкции");
  });

  test("rejects an empty assistant instructions file", async () => {
    const instructionsFile = createInstructionsFixture("");

    await expect(loadAssistantInstructions(instructionsFile)).rejects.toThrow(
      /Assistant instructions file is empty/
    );
  });

  test("assistant instructions stay neutral", () => {
    const instructions = readFileSync("config/assistant-instructions.md", "utf8");

    expect(instructions).toContain("ассистент");
    expect(instructions).toContain("без выдумок");
    expect(instructions).toContain("не придумывай роль или характер");
    expect(instructions).toContain("приоритетнее общих правил");
    expect(instructions).toContain("не переключайся в режим справки");
    expect(instructions).toContain("если активная команда уже задаёт формат и задачу");
    expect(instructions).not.toContain("если данных не хватает, лучше уточни");
  });
});

function createInstructionsFixture(baseInstructions: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "chatbot-instructions-"));
  const instructionsFile = path.join(directory, "assistant-instructions.md");

  tempDirectories.push(directory);
  writeFileSync(instructionsFile, `${baseInstructions}\n`, "utf8");

  return instructionsFile;
}
