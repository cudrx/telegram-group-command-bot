import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type DeployMetadata = {
  sha: string;
  shortSha: string;
  branch: string;
  builtAt: string;
  commits: string[];
  productContext: string;
  changedFiles: string[];
  documentationChanges: string;
};

export function createDeployMetadata(input: {
  deployedSha?: string | null;
  beforeSha: string | null;
  sha: string;
  branch: string;
  now: () => string;
  gitLog: (range: string) => string;
  productContext?: string;
  changedFiles?: string[];
  documentationChanges?: string;
}): DeployMetadata {
  const output = readGitLog(input.gitLog, [
    ...createDeployedCommitRanges(input.deployedSha, input.sha),
    ...createBeforeCommitRanges(input.beforeSha, input.sha),
    createCurrentCommitRange(input.sha)
  ]);

  return {
    sha: input.sha,
    shortSha: input.sha.slice(0, 7),
    branch: input.branch,
    builtAt: input.now(),
    commits: parseCommitSubjects(output),
    productContext: input.productContext ?? '',
    changedFiles: input.changedFiles ?? [],
    documentationChanges: input.documentationChanges ?? ''
  };
}

export function writeDeployMetadata(
  outputPath: string,
  metadata: DeployMetadata
): void {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function readGitLog(
  gitLog: (range: string) => string,
  ranges: string[]
): string {
  let lastError: unknown;

  for (const range of dedupe(ranges)) {
    try {
      return gitLog(range);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function createDeployedCommitRanges(
  deployedSha: string | null | undefined,
  sha: string
): string[] {
  if (!deployedSha || isZeroSha(deployedSha)) {
    return [];
  }

  return [createCommitRange(deployedSha, sha)];
}

function createBeforeCommitRanges(
  beforeSha: string | null,
  sha: string
): string[] {
  if (!beforeSha || isZeroSha(beforeSha)) {
    return [];
  }

  return [createCommitRange(beforeSha, sha)];
}

function createCommitRange(beforeSha: string, sha: string): string {
  return `${beforeSha}..${sha}`;
}

function createCurrentCommitRange(sha: string): string {
  return `${sha}^..${sha}`;
}

function parseCommitSubjects(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isZeroSha(value: string): boolean {
  return /^0+$/.test(value);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function gitLog(range: string): string {
  return execFileSync('git', ['log', '--format=%s', range], {
    encoding: 'utf8'
  });
}

function gitDiff(range: string, args: string[]): string {
  return execFileSync('git', ['diff', ...args, range], { encoding: 'utf8' });
}

function runFromCli(): void {
  const sha = process.env.DEPLOY_METADATA_SHA ?? process.env.GITHUB_SHA;

  if (!sha) {
    throw new Error('DEPLOY_METADATA_SHA or GITHUB_SHA is required.');
  }

  const ranges = dedupe([
    ...createDeployedCommitRanges(
      process.env.DEPLOY_METADATA_DEPLOYED_SHA,
      sha
    ),
    ...createBeforeCommitRanges(
      process.env.DEPLOY_METADATA_BEFORE_SHA ?? null,
      sha
    ),
    createCurrentCommitRange(sha)
  ]);
  const selected = readGitLogWithRange(gitLog, ranges);
  const metadata = createDeployMetadata({
    deployedSha: process.env.DEPLOY_METADATA_DEPLOYED_SHA ?? null,
    beforeSha: process.env.DEPLOY_METADATA_BEFORE_SHA ?? null,
    sha,
    branch:
      process.env.DEPLOY_METADATA_BRANCH ??
      process.env.GITHUB_REF_NAME ??
      'main',
    now: () => new Date().toISOString(),
    gitLog: () => selected.output,
    productContext: readProductContext(),
    changedFiles: parseChangedFiles(
      gitDiff(selected.range, ['--name-only'])
    ).slice(0, 200),
    documentationChanges: gitDiff(selected.range, [
      '--unified=1',
      '--',
      'README.md',
      'docs/architecture.md',
      'docs/development.md'
    ]).slice(0, 12_000)
  });
  const outputPath =
    process.env.DEPLOY_METADATA_OUTPUT ??
    'deploy/generated/deploy-metadata.json';

  writeDeployMetadata(outputPath, metadata);
}

function readGitLogWithRange(
  reader: (range: string) => string,
  ranges: string[]
): { output: string; range: string } {
  let lastError: unknown;

  for (const range of ranges) {
    try {
      return { output: reader(range), range };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function readProductContext(): string {
  const readme = readFileSync('README.md', 'utf8');
  const quickStartIndex = readme.indexOf('\n## Quick Start');
  const overview =
    quickStartIndex >= 0 ? readme.slice(0, quickStartIndex) : readme;

  return overview.slice(0, 4_000).trim();
}

function parseChangedFiles(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFromCli();
}
