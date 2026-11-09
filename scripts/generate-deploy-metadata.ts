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
  sha: string;
  branch: string;
  now: () => string;
  commitLog: string;
  productContext?: string;
  changedFiles?: string[];
  documentationChanges?: string;
}): DeployMetadata {
  return {
    sha: input.sha,
    shortSha: input.sha.slice(0, 7),
    branch: input.branch,
    builtAt: input.now(),
    commits: parseLines(input.commitLog),
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

export function readDeployCommits(input: {
  deployedSha?: string | null;
  beforeSha?: string | null;
  sha: string;
  gitLog: (range: string) => string;
}): { output: string; range: string } {
  let lastError: unknown;

  for (const base of new Set([
    input.deployedSha,
    input.beforeSha,
    `${input.sha}^`
  ])) {
    if (!base || /^0+$/.test(base)) continue;

    const range = `${base}..${input.sha}`;
    try {
      return { output: input.gitLog(range), range };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function parseLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
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

  const selected = readDeployCommits({
    deployedSha: process.env.DEPLOY_METADATA_DEPLOYED_SHA ?? null,
    beforeSha: process.env.DEPLOY_METADATA_BEFORE_SHA ?? null,
    sha,
    gitLog
  });
  const metadata = createDeployMetadata({
    sha,
    branch:
      process.env.DEPLOY_METADATA_BRANCH ??
      process.env.GITHUB_REF_NAME ??
      'main',
    now: () => new Date().toISOString(),
    commitLog: selected.output,
    productContext: readProductContext(),
    changedFiles: parseLines(gitDiff(selected.range, ['--name-only'])).slice(
      0,
      200
    ),
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
    '.github/generated/deploy-metadata.json';

  writeDeployMetadata(outputPath, metadata);
}

function readProductContext(): string {
  const readme = readFileSync('README.md', 'utf8');
  const quickStartIndex = readme.indexOf('\n## Quick Start');
  const overview =
    quickStartIndex >= 0 ? readme.slice(0, quickStartIndex) : readme;

  return overview.slice(0, 4_000).trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFromCli();
}
