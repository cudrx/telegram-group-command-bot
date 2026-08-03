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

const scriptPath = resolve('deploy/remote-deploy.sh');

function fakeDockerScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "$DOCKER_CALLS_PATH"

if [[ "$*" == *"compose"*"up -d --wait --wait-timeout 30 bot"* ]]; then
  printf 'up-image-tag=%s\\n' "\${IMAGE_TAG:-}" >> "$DOCKER_CALLS_PATH"
fi

if [[ "$*" == *"compose"*"images -q bot"* ]]; then
  printf '%s\\n' 'sha256:previous'
elif [[ "$*" == "inspect --format={{.Config.Image}} sha256:previous" ]]; then
  printf '%s\\n' 'ghcr.io/example/bot:previous-sha'
elif [[ "$*" == *"compose"*"up -d --wait --wait-timeout 30 bot"* ]] && [[ "\${IMAGE_TAG:-}" != "previous-sha" ]]; then
  exit "\${FAKE_DOCKER_UP_EXIT:-0}"
fi
`;
}

function runDeploy(upExit = '0'): { calls: string[]; status: number | null } {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'remote-deploy-test-'));
  const binDir = join(fixtureDir, 'bin');
  const callsPath = join(fixtureDir, 'docker-calls.log');
  mkdirSync(binDir);
  writeFileSync(join(fixtureDir, '.env'), 'GHCR_IMAGE=ghcr.io/example/bot\n');
  writeFileSync(join(fixtureDir, 'compose.yml'), 'services: {}\n');
  writeFileSync(join(binDir, 'docker'), fakeDockerScript(), { mode: 0o755 });

  const result = spawnSync('bash', [scriptPath], {
    env: {
      ...process.env,
      DEPLOY_PATH: fixtureDir,
      IMAGE_TAG: 'new-sha',
      SERVER_GHCR_USERNAME: 'user',
      SERVER_GHCR_TOKEN: 'token',
      DOCKER_CALLS_PATH: callsPath,
      FAKE_DOCKER_UP_EXIT: upExit,
      PATH: `${binDir}:${process.env.PATH}`
    },
    stdio: 'pipe'
  });

  const deployResult = {
    calls: readFileSync(callsPath, 'utf8').trim().split('\n'),
    status: result.status
  };
  rmSync(fixtureDir, { recursive: true });

  return deployResult;
}

describe('remote deploy', () => {
  test('waits for the new container and keeps tagged images for rollback', () => {
    const { calls, status } = runDeploy();

    expect(status).toBe(0);
    expect(calls).toContain(
      'compose --env-file .env -f compose.yml up -d --wait --wait-timeout 30 bot'
    );
    expect(calls).toContain('image prune -f');
    expect(calls).not.toContain('image prune -a -f');
  });

  test('restores the previous image tag when health verification fails', () => {
    const { calls, status } = runDeploy('1');

    expect(status).toBe(1);
    expect(calls).toContain(
      'compose --env-file .env -f compose.yml images -q bot'
    );
    expect(calls).toContain(
      'inspect --format={{.Config.Image}} sha256:previous'
    );
    expect(
      calls.filter(
        (call) =>
          call ===
          'compose --env-file .env -f compose.yml up -d --wait --wait-timeout 30 bot'
      )
    ).toHaveLength(2);
    expect(calls).toContain('up-image-tag=previous-sha');
  });
});
