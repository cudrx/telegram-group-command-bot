import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { storageConfig } from '../config/runtime/index.js';

export const DEPLOY_METADATA_FILE: string = storageConfig.deployMetadataFile;

const deployMetadataSchema = z.object({
  sha: z.string().min(1),
  shortSha: z.string().min(1),
  branch: z.string().min(1),
  builtAt: z.string().datetime().nullable(),
  commits: z.array(z.string().min(1))
});

export type DeployMetadata = z.infer<typeof deployMetadataSchema>;

export type DeployMetadataLoadResult =
  | { status: 'ok'; metadata: DeployMetadata }
  | { status: 'skipped'; reason: string };

export function loadDeployMetadata(
  filePath = DEPLOY_METADATA_FILE
): DeployMetadataLoadResult {
  let raw: string;

  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    return {
      status: 'skipped',
      reason: isMissingFileError(error)
        ? 'Deploy metadata file is missing.'
        : 'Deploy metadata file could not be read.'
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: 'skipped',
      reason: 'Deploy metadata JSON is invalid.'
    };
  }

  const metadata = deployMetadataSchema.safeParse(parsed);

  if (!metadata.success) {
    return {
      status: 'skipped',
      reason: 'Deploy metadata shape is invalid.'
    };
  }

  if (metadata.data.sha === 'unknown') {
    return {
      status: 'skipped',
      reason: 'Deploy metadata sha is unknown.'
    };
  }

  if (metadata.data.commits.length === 0) {
    return {
      status: 'skipped',
      reason: 'Deploy metadata has no commits.'
    };
  }

  return {
    status: 'ok',
    metadata: metadata.data
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
