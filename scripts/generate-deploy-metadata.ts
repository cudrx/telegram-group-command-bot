import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type DeployMetadata = {
  sha: string;
  shortSha: string;
  branch: string;
  builtAt: string;
  commits: string[];
};

export function createDeployMetadata(input: {
  deployedSha?: string | null;
  beforeSha: string | null;
  sha: string;
  branch: string;
  now: () => string;
  gitLog: (range: string) => string;
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
    commits: parseCommitSubjects(output)
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

function runFromCli(): void {
  const sha = process.env.DEPLOY_METADATA_SHA ?? process.env.GITHUB_SHA;

  if (!sha) {
    throw new Error('DEPLOY_METADATA_SHA or GITHUB_SHA is required.');
  }

  const metadata = createDeployMetadata({
    deployedSha: process.env.DEPLOY_METADATA_DEPLOYED_SHA ?? null,
    beforeSha: process.env.DEPLOY_METADATA_BEFORE_SHA ?? null,
    sha,
    branch:
      process.env.DEPLOY_METADATA_BRANCH ??
      process.env.GITHUB_REF_NAME ??
      'main',
    now: () => new Date().toISOString(),
    gitLog
  });
  const outputPath =
    process.env.DEPLOY_METADATA_OUTPUT ??
    'deploy/generated/deploy-metadata.json';

  writeDeployMetadata(outputPath, metadata);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFromCli();
}
