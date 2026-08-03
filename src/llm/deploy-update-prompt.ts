import { language } from '../locales/locale.js';
import { loadPrompt } from './prompt-files.js';
import { renderPromptTemplate } from './prompts/render.js';

export function buildDeployUpdatePrompt(input: {
  shortSha: string;
  commits: string[];
  productContext: string;
  changedFiles: string[];
  documentationChanges: string;
}): string {
  return [
    renderPromptTemplate(loadPrompt('updateAnnouncement'), {
      targetLanguageName: language.targetLanguageName
    }),
    '',
    'Input data:',
    '',
    'Product context:',
    input.productContext || '(not available)',
    '',
    `Commit SHA: ${input.shortSha}`,
    '',
    'Commits:',
    ...input.commits.map((commit) => `- ${commit}`),
    '',
    'Changed files:',
    ...input.changedFiles.map((file) => `- ${file}`),
    '',
    'Relevant documentation changes:',
    input.documentationChanges || '(none)'
  ].join('\n');
}
