import { appendFileSync } from 'node:fs';

const { IMAGE_PREFIX, IMAGE_TAG, PUBLISH, BUILD_METADATA, GITHUB_OUTPUT } =
  process.env;
if (!IMAGE_PREFIX || !IMAGE_TAG || !GITHUB_OUTPUT) {
  throw new Error('IMAGE_PREFIX, IMAGE_TAG and GITHUB_OUTPUT are required');
}

const metadata = PUBLISH === 'true' ? JSON.parse(BUILD_METADATA ?? '{}') : {};
const outputs = ['bot', 'video', 'gallery'].map((target) => {
  const repository = `${IMAGE_PREFIX}${target === 'bot' ? '' : `-${target}`}`;
  let reference = `${repository}:${IMAGE_TAG}`;
  if (PUBLISH === 'true') {
    const digest = metadata[target]?.['containerimage.digest'];
    if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`Missing or invalid published digest for ${target}`);
    }
    reference = `${repository}@${digest}`;
  }

  return `${target}-image=${reference}`;
});
appendFileSync(GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
