import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

function selectImages(metadata: Record<string, unknown>, publish = true) {
  const root = mkdtempSync(join(tmpdir(), 'image-refs-test-'));
  const output = join(root, 'output');
  const result = spawnSync(
    process.execPath,
    [resolve('.github/image-refs.mjs')],
    {
      env: {
        ...process.env,
        IMAGE_PREFIX: 'ghcr.io/example/bot',
        IMAGE_TAG: 'same-commit',
        PUBLISH: String(publish),
        BUILD_METADATA: JSON.stringify(metadata),
        GITHUB_OUTPUT: output
      },
      encoding: 'utf8'
    }
  );
  const refs = result.status === 0 ? readFileSync(output, 'utf8') : '';
  rmSync(root, { recursive: true, force: true });
  return { status: result.status, refs };
}

const metadata = {
  bot: { 'containerimage.digest': `sha256:${'a'.repeat(64)}` },
  video: { 'containerimage.digest': `sha256:${'b'.repeat(64)}` },
  gallery: { 'containerimage.digest': `sha256:${'c'.repeat(64)}` }
};

describe('CI image references', () => {
  test('exports the exact published digests for smoke checks and deployment', () => {
    const result = selectImages(metadata);
    expect(result.status).toBe(0);
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

  test('uses locally loaded tags for non-publishing CI builds', () => {
    const result = selectImages({}, false);
    expect(result.status).toBe(0);
    expect(result.refs).toContain(
      'video-image=ghcr.io/example/bot-video:same-commit\n'
    );
  });
});
