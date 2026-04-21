import { readFileSync } from 'node:fs';

export const PROMPT_FILE_PATHS = {
  base: 'llm/assistant/base.md',
  global: 'llm/reply/global.md',
  replyShell: 'llm/reply/shell.md',
  explain: 'llm/reply/explain.md',
  summarize: 'llm/reply/summarize.md',
  decide: 'llm/reply/decide.md',
  read: 'llm/reply/read.md',
  answer: 'llm/reply/answer.md',
  systemExplain: 'llm/system/explain.md',
  systemRead: 'llm/system/read.md',
  systemGeneric: 'llm/system/generic.md',
  systemTranscript: 'llm/system/transcript.md',
  cloudflareVisionSystem: 'llm/vision/cloudflare-system.md',
  cloudflareVisionUser: 'llm/vision/cloudflare-user.md',
  lookup: 'llm/planner/lookup.md',
  lookupContext: 'llm/reply/lookup-context.md',
  updateAnnouncement: 'llm/deploy/update-announcement.md'
} as const;

export type PromptName = keyof typeof PROMPT_FILE_PATHS;

export function loadPrompt(promptName: PromptName): string {
  return loadPromptFile(PROMPT_FILE_PATHS[promptName], promptName);
}

export function loadPromptFile(
  filePath: string,
  promptName = filePath
): string {
  let prompt: string;

  try {
    prompt = readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `Required prompt file is missing: ${promptName} (${filePath})`
      );
    }

    throw error;
  }

  if (prompt.length === 0) {
    throw new Error(`Prompt file is empty: ${promptName} (${filePath})`);
  }

  return prompt;
}
