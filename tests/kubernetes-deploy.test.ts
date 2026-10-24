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

function deploy(
  input: { exists?: boolean; fail?: boolean; applyFail?: boolean } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'kubernetes-deploy-test-'));
  mkdirSync(join(root, 'bin'));
  const calls = join(root, 'calls');
  const state = join(root, 'state');
  writeFileSync(join(root, 'metadata.json'), '{"sha":"test"}');
  writeFileSync(
    join(root, 'bin/kubectl'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TEST_CALLS"
case "$*" in
  *'get deployment'*) [[ "$TEST_EXISTS" == yes ]] && printf 'deployment.apps/telegram-bot' || true ;;
  *'create configmap'*) printf 'apiVersion: v1\\nkind: ConfigMap\\n' ;;
  *'apply -f -'*) cat > /dev/null; printf 'deploy-metadata-0123456789012345678901234567890123456789-contenthash' ;;
  *'apply -f '*) cp "\${@: -1}" "$TEST_RENDERED"; exit "$TEST_APPLY_EXIT" ;;
  *'rollout undo'*) touch "$TEST_STATE" ;;
  *'rollout status'*) [[ -f "$TEST_STATE" ]] || exit "$TEST_ROLLOUT_EXIT" ;;
esac
`,
    { mode: 0o755 }
  );
  const result = spawnSync('bash', [resolve('.github/deploy.sh')], {
    env: {
      ...process.env,
      PATH: `${root}/bin:${process.env.PATH}`,
      IMAGE_PREFIX: 'ghcr.io/example/bot',
      IMAGE_TAG: '0123456789012345678901234567890123456789',
      DEPLOY_METADATA_FILE: join(root, 'metadata.json'),
      TEST_CALLS: calls,
      TEST_STATE: state,
      TEST_RENDERED: join(root, 'rendered.yml'),
      TEST_EXISTS: input.exists === false ? 'no' : 'yes',
      TEST_ROLLOUT_EXIT: input.fail ? '1' : '0',
      TEST_APPLY_EXIT: input.applyFail ? '1' : '0'
    },
    encoding: 'utf8'
  });
  const output = {
    status: result.status,
    calls: readFileSync(calls, 'utf8'),
    manifest: readFileSync(join(root, 'rendered.yml'), 'utf8')
  };
  rmSync(root, { recursive: true, force: true });
  return output;
}

describe('Kubernetes deployment', () => {
  test('deploys matching images and metadata, then waits for readiness', () => {
    const result = deploy();
    expect(result.status).toBe(0);
    expect(result.manifest).toContain(
      'ghcr.io/example/bot-video:0123456789012345678901234567890123456789'
    );
    expect(result.manifest).toContain(
      'name: deploy-metadata-0123456789012345678901234567890123456789-contenthash'
    );
    expect(result.manifest).not.toContain('${IMAGE_');
    expect(result.calls).toContain(
      'rollout status deployment/telegram-bot --timeout=300s'
    );
    expect(result.calls).not.toContain('rollout undo');
  });

  test('rolls back the entire pod revision and keeps the deployment failed', () => {
    const result = deploy({ fail: true });
    expect(result.status).toBe(1);
    expect(result.calls).toContain('rollout undo deployment/telegram-bot');
    expect(result.calls.match(/rollout status/g)).toHaveLength(2);
  });

  test('does not try to undo a failed first deployment', () => {
    const result = deploy({ fail: true, exists: false });
    expect(result.status).toBe(1);
    expect(result.calls).not.toContain('rollout undo');
  });

  test('stops immediately when applying the manifest fails', () => {
    const result = deploy({ applyFail: true });
    expect(result.status).toBe(1);
    expect(result.calls).not.toContain('rollout status');
  });
});
