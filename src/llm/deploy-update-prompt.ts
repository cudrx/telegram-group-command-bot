import { language } from '../locales/locale.js';
import { loadPrompt } from './prompt-files.js';
import { renderPromptTemplate } from './prompts/render.js';

export function buildDeployUpdatePrompt(input: {
  shortSha: string;
  commits: string[];
}): string {
  return [
    renderPromptTemplate(loadPrompt('updateAnnouncement'), {
      targetLanguageName: language.targetLanguageName
    }),
    '',
    'Input data:',
    '',
    `Commit SHA: ${input.shortSha}`,
    '',
    'Commits:',
    ...input.commits.map((commit) => `- ${commit}`)
  ].join('\n');
}
