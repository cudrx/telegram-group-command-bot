import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createDeployMetadata,
  readDeployCommits,
  writeDeployMetadata
} from '../scripts/generate-deploy-metadata.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('generate deploy metadata', () => {
  test('creates metadata from the selected commit log', () => {
    const metadata = createDeployMetadata({
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      branch: 'main',
      now: () => '2026-04-19T10:00:00.000Z',
      commitLog: 'fix: captions\nfeat: announcements\n',
      productContext: 'Telegram media bot.',
      changedFiles: ['src/media.ts'],
      documentationChanges: 'Media links are expanded.'
    });

    expect(metadata).toEqual({
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      shortSha: 'f3f896a',
      branch: 'main',
      builtAt: '2026-04-19T10:00:00.000Z',
      commits: ['fix: captions', 'feat: announcements'],
      productContext: 'Telegram media bot.',
      changedFiles: ['src/media.ts'],
      documentationChanges: 'Media links are expanded.'
    });
  });

  test('reads the push commit range once', () => {
    const gitLog = vi.fn().mockReturnValue('fix: captions\n');
    const selected = readDeployCommits({
      beforeSha: 'before-sha',
      sha: 'current-sha',
      gitLog
    });

    expect(gitLog).toHaveBeenCalledExactlyOnceWith('before-sha..current-sha');
    expect(selected).toEqual({
      range: 'before-sha..current-sha',
      output: 'fix: captions\n'
    });
  });

  test('prefers the currently deployed sha over the push commit range', () => {
    const gitLog = vi.fn().mockReturnValue('fix: captions\n');

    const selected = readDeployCommits({
      deployedSha: 'deployed-sha',
      beforeSha: 'push-before-sha',
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      gitLog
    });

    expect(gitLog).toHaveBeenCalledWith(
      'deployed-sha..f3f896a0c03d0c109db633a6182e798e8ca0b96f'
    );
    expect(selected.range).toBe(
      'deployed-sha..f3f896a0c03d0c109db633a6182e798e8ca0b96f'
    );
  });

  test('uses the current commit when before sha is all zeroes', () => {
    const gitLog = vi.fn().mockReturnValue('feat: first deploy\n');

    readDeployCommits({
      beforeSha: '0000000000000000000000000000000000000000',
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      gitLog
    });

    expect(gitLog).toHaveBeenCalledWith(
      'f3f896a0c03d0c109db633a6182e798e8ca0b96f^..f3f896a0c03d0c109db633a6182e798e8ca0b96f'
    );
  });

  test('falls back to the current commit when the range is not available', () => {
    const gitLog = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Invalid revision range');
      })
      .mockReturnValueOnce('fix: current only\n');

    const selected = readDeployCommits({
      beforeSha: 'missing-before-sha',
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      gitLog
    });

    expect(gitLog).toHaveBeenNthCalledWith(
      1,
      'missing-before-sha..f3f896a0c03d0c109db633a6182e798e8ca0b96f'
    );
    expect(gitLog).toHaveBeenNthCalledWith(
      2,
      'f3f896a0c03d0c109db633a6182e798e8ca0b96f^..f3f896a0c03d0c109db633a6182e798e8ca0b96f'
    );
    expect(selected).toEqual({
      range:
        'f3f896a0c03d0c109db633a6182e798e8ca0b96f^..f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      output: 'fix: current only\n'
    });
  });

  test('writes metadata JSON to disk', () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'deploy-metadata-out-')
    );
    tempDirectories.push(directory);
    const outputPath = path.join(directory, 'nested', 'deploy-metadata.json');

    writeDeployMetadata(outputPath, {
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      shortSha: 'f3f896a',
      branch: 'main',
      builtAt: '2026-04-19T10:00:00.000Z',
      commits: ['fix: captions'],
      productContext: 'Telegram media bot.',
      changedFiles: ['src/media.ts'],
      documentationChanges: 'Media captions are supported.'
    });

    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual({
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      shortSha: 'f3f896a',
      branch: 'main',
      builtAt: '2026-04-19T10:00:00.000Z',
      commits: ['fix: captions'],
      productContext: 'Telegram media bot.',
      changedFiles: ['src/media.ts'],
      documentationChanges: 'Media captions are supported.'
    });
  });
});
