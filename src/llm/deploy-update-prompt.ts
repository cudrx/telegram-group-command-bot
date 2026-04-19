import { loadPromptFile } from './prompt-files.js';

const DEPLOY_UPDATE_PROMPT = loadPromptFile(
  'llm/deploy/update-announcement.md'
);

export function buildDeployUpdatePrompt(input: {
  shortSha: string;
  commits: string[];
}): string {
  return [
    DEPLOY_UPDATE_PROMPT,
    '',
    'Input data:',
    '',
    `Commit SHA: ${input.shortSha}`,
    '',
    'Commits:',
    ...input.commits.map((commit) => `- ${commit}`)
  ].join('\n');
}
