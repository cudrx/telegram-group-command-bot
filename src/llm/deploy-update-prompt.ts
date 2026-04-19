import { loadPrompt } from './prompt-files.js';

export function buildDeployUpdatePrompt(input: {
  shortSha: string;
  commits: string[];
}): string {
  return [
    loadPrompt('updateAnnouncement'),
    '',
    'Input data:',
    '',
    `Commit SHA: ${input.shortSha}`,
    '',
    'Commits:',
    ...input.commits.map((commit) => `- ${commit}`)
  ].join('\n');
}
