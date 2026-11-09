import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

function selectImages(metadata: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'image-refs-test-'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(
    join(root, 'bin/docker'),
    `#!${process.execPath}
const image = process.argv.at(-1);
const target = image.includes('-video:') ? 'video' : image.includes('-gallery:') ? 'gallery' : 'bot';
const digest = JSON.parse(process.env.TEST_METADATA)[target]?.['containerimage.digest'];
console.log(JSON.stringify(digest ? [image.split(':')[0] + '@' + digest] : []));
`,
    { mode: 0o755 }
  );
  const output = join(root, 'output');
  const result = spawnSync(
    process.execPath,
    [resolve('.github/image-refs.mjs')],
    {
      env: {
        ...process.env,
        IMAGE_PREFIX: 'ghcr.io/example/bot',
        IMAGE_TAG: 'same-commit',
        PATH: `${root}/bin:${process.env.PATH}`,
        TEST_METADATA: JSON.stringify(metadata),
        GITHUB_OUTPUT: output
      },
      encoding: 'utf8'
    }
  );
  const refs = result.status === 0 ? readFileSync(output, 'utf8') : '';
  rmSync(root, { recursive: true, force: true });
  return { status: result.status, refs, stderr: result.stderr };
}

const metadata = {
  bot: { 'containerimage.digest': `sha256:${'a'.repeat(64)}` },
  video: { 'containerimage.digest': `sha256:${'b'.repeat(64)}` },
  gallery: { 'containerimage.digest': `sha256:${'c'.repeat(64)}` }
};

describe('CI image references', () => {
  test('exports digests of the tested images after they have been pushed', () => {
    const result = selectImages(metadata);
    expect(result.status, result.stderr).toBe(0);
    expect(result.refs).toBe(
      `bot-image=ghcr.io/example/bot@sha256:${'a'.repeat(64)}\nvideo-image=ghcr.io/example/bot-video@sha256:${'b'.repeat(64)}\ngallery-image=ghcr.io/example/bot-gallery@sha256:${'c'.repeat(64)}\n`
    );
  });

  test('selects a rebuilt image even when the commit tag stays the same', () => {
    const result = selectImages({
      ...metadata,
      bot: { 'containerimage.digest': `sha256:${'d'.repeat(64)}` }
    });
    expect(result.status).toBe(0);
    expect(result.refs).toContain(
      `bot-image=ghcr.io/example/bot@sha256:${'d'.repeat(64)}`
    );
  });

  test('fails instead of deploying a mutable tag if a digest is missing', () => {
    expect(
      selectImages({ bot: metadata.bot, video: metadata.video }).status
    ).not.toBe(0);
  });
});
