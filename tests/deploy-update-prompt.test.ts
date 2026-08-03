import { expect, test } from 'vitest';

import { buildDeployUpdatePrompt } from '../src/llm/deploy-update-prompt.js';

test('adds deploy metadata to the update prompt', () => {
  const prompt = buildDeployUpdatePrompt({
    shortSha: '9c59b85',
    commits: [
      'fix: handle telegram media captions',
      'feat: add release update notifications'
    ],
    productContext: 'A Telegram bot that expands social media links.',
    changedFiles: ['src/app/media.ts', 'docs/architecture.md'],
    documentationChanges: 'TikTok links are expanded into videos.'
  });

  expect(prompt).toContain('Commit SHA: 9c59b85');
  expect(prompt).toContain('- fix: handle telegram media captions');
  expect(prompt).toContain('- feat: add release update notifications');
  expect(prompt).toContain('A Telegram bot that expands social media links.');
  expect(prompt).toContain('src/app/media.ts');
  expect(prompt).toContain('TikTok links are expanded into videos.');
});
