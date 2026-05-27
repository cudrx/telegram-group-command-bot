import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { buildDeployUpdatePrompt } from '../src/llm/deploy-update-prompt.js';

test('keeps static deploy update prompt text in llm markdown files', () => {
  expect(readFileSync('llm/deploy/update-announcement.md', 'utf8')).toContain(
    'You are writing a short Telegram update about a new bot release.'
  );
});

test('builds a Telegram update formatting prompt', () => {
  const prompt = buildDeployUpdatePrompt({
    shortSha: '9c59b85',
    commits: [
      'fix: handle telegram media captions',
      'feat: add release update notifications'
    ]
  });

  expect(prompt).toContain('Write in Russian.');
  expect(prompt).toContain('added');
  expect(prompt).toContain(
    'Do not mention git, commits, Docker, CI/CD, deployment'
  );
  expect(prompt).toContain('Commit SHA: 9c59b85');
  expect(prompt).toContain('- fix: handle telegram media captions');
  expect(prompt).toContain('- feat: add release update notifications');
});
