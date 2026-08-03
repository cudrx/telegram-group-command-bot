import { expect, test } from 'vitest';

import { buildDeployUpdatePrompt } from '../src/llm/deploy-update-prompt.js';

test('adds deploy metadata to the update prompt', () => {
  const prompt = buildDeployUpdatePrompt({
    shortSha: '9c59b85',
    commits: [
      'fix: handle telegram media captions',
      'feat: add release update notifications'
    ]
  });

  expect(prompt).toContain('Commit SHA: 9c59b85');
  expect(prompt).toContain('- fix: handle telegram media captions');
  expect(prompt).toContain('- feat: add release update notifications');
});
