import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const { IMAGE_PREFIX, IMAGE_TAG, GITHUB_OUTPUT } = process.env;
if (!IMAGE_PREFIX || !IMAGE_TAG || !GITHUB_OUTPUT) {
  throw new Error('IMAGE_PREFIX, IMAGE_TAG and GITHUB_OUTPUT are required');
}

const outputs = ['bot', 'video', 'gallery'].map((target) => {
  const repository = `${IMAGE_PREFIX}${target === 'bot' ? '' : `-${target}`}`;
  const digests = JSON.parse(
    execFileSync(
      'docker',
      [
        'image',
        'inspect',
        '--format',
        '{{json .RepoDigests}}',
        `${repository}:${IMAGE_TAG}`
      ],
      { encoding: 'utf8' }
    )
  );
  const reference = digests?.find((entry) =>
    entry.startsWith(`${repository}@sha256:`)
  );
  if (
    typeof reference !== 'string' ||
    !/@sha256:[a-f0-9]{64}$/.test(reference)
  ) {
    throw new Error(`Missing or invalid published digest for ${target}`);
  }

  return `${target}-image=${reference}`;
});
appendFileSync(GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
