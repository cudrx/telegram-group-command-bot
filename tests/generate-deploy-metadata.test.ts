import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createDeployMetadata,
  writeDeployMetadata
} from '../scripts/generate-deploy-metadata.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('generate deploy metadata', () => {
  test('creates metadata from a push commit range', () => {
    const gitLog = vi
      .fn()
      .mockReturnValue('fix: captions\nfeat: announcements\n');

    const metadata = createDeployMetadata({
      beforeSha: 'before-sha',
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      branch: 'main',
      now: () => '2026-04-19T10:00:00.000Z',
      gitLog
    });

    expect(gitLog).toHaveBeenCalledWith(
      'before-sha..f3f896a0c03d0c109db633a6182e798e8ca0b96f'
    );
    expect(metadata).toEqual({
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      shortSha: 'f3f896a',
      branch: 'main',
      builtAt: '2026-04-19T10:00:00.000Z',
      commits: ['fix: captions', 'feat: announcements']
    });
  });

  test('prefers the currently deployed sha over the push commit range', () => {
    const gitLog = vi
      .fn()
      .mockReturnValue(
        [
          'refactor: delete completed plans',
          'refactor: simplify Codex instruction routing',
          'refactor: tighten standalone prompt wording',
          'fix: captions'
        ].join('\n')
      );

    const metadata = createDeployMetadata({
      deployedSha: 'deployed-sha',
      beforeSha: 'push-before-sha',
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      branch: 'main',
      now: () => '2026-04-19T10:00:00.000Z',
      gitLog
    });

    expect(gitLog).toHaveBeenCalledWith(
      'deployed-sha..f3f896a0c03d0c109db633a6182e798e8ca0b96f'
    );
    expect(metadata.commits).toEqual([
      'refactor: delete completed plans',
      'refactor: simplify Codex instruction routing',
      'refactor: tighten standalone prompt wording',
      'fix: captions'
    ]);
  });

  test('uses the current commit when before sha is all zeroes', () => {
    const gitLog = vi.fn().mockReturnValue('feat: first deploy\n');

    createDeployMetadata({
      beforeSha: '0000000000000000000000000000000000000000',
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      branch: 'main',
      now: () => '2026-04-19T10:00:00.000Z',
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

    const metadata = createDeployMetadata({
      beforeSha: 'missing-before-sha',
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      branch: 'main',
      now: () => '2026-04-19T10:00:00.000Z',
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
    expect(metadata.commits).toEqual(['fix: current only']);
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
      commits: ['fix: captions']
    });

    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual({
      sha: 'f3f896a0c03d0c109db633a6182e798e8ca0b96f',
      shortSha: 'f3f896a',
      branch: 'main',
      builtAt: '2026-04-19T10:00:00.000Z',
      commits: ['fix: captions']
    });
  });
});
