import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  loadPrompt,
  loadPromptFile,
  PROMPT_FILE_PATHS
} from '../src/llm/prompt-files.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('prompt file registry', () => {
  test('keeps one source of truth for all prompt file paths', () => {
    expect(PROMPT_FILE_PATHS).toEqual({
      base: 'llm/assistant/base.md',
      global: 'llm/reply/global.md',
      explain: 'llm/reply/explain.md',
      summarize: 'llm/reply/summarize.md',
      decide: 'llm/reply/decide.md',
      lookup: 'llm/planner/lookup.md',
      lookupContext: 'llm/reply/lookup-context.md',
      updateAnnouncement: 'llm/deploy/update-announcement.md'
    });
  });

  test('loads every registered prompt file by name', () => {
    for (const promptName of Object.keys(PROMPT_FILE_PATHS)) {
      const registeredPath =
        PROMPT_FILE_PATHS[promptName as keyof typeof PROMPT_FILE_PATHS];

      expect(loadPrompt(promptName as keyof typeof PROMPT_FILE_PATHS)).toBe(
        readFileSync(registeredPath, 'utf8').trim()
      );
    }
  });

  test('base assistant instructions stay neutral', () => {
    const instructions = loadPrompt('base');

    expect(instructions).toContain('ассистент');
    expect(instructions).toContain('без выдумок');
    expect(instructions).toContain('не придумывай роль или характер');
    expect(instructions).toContain('приоритетнее общих правил');
    expect(instructions).toContain('не переключайся в режим справки');
    expect(instructions).toContain(
      'если активная команда уже задаёт формат и задачу'
    );
    expect(instructions).not.toContain('если данных не хватает, лучше уточни');
  });

  test('reloads prompt file content on every read', () => {
    const promptFile = createPromptFixture('first version');

    expect(loadPromptFile(promptFile, 'fixture')).toBe('first version');

    writeFileSync(promptFile, 'second version\n', 'utf8');

    expect(loadPromptFile(promptFile, 'fixture')).toBe('second version');
  });

  test('throws a useful error when a required prompt file is missing', () => {
    const missingPath = path.join(createTempDirectory(), 'missing-prompt.md');

    expect(() => loadPromptFile(missingPath, 'missingPrompt')).toThrow(
      `Required prompt file is missing: missingPrompt (${missingPath})`
    );
  });
});

function createPromptFixture(contents: string): string {
  const directory = createTempDirectory();
  const promptFile = path.join(directory, 'prompt.md');
  writeFileSync(promptFile, `${contents}\n`, 'utf8');
  return promptFile;
}

function createTempDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'chatbot-prompts-'));
  tempDirectories.push(directory);
  return directory;
}
