import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

function deploy(fail = '') {
  const root = mkdtempSync(join(tmpdir(), 'compose-deploy-test-'));
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data/bot.sqlite'), 'existing database');
  writeFileSync(
    join(root, 'bin/docker'),
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$TEST_ROOT/calls"
case " $* " in
  *" info "*)
    [[ "$TEST_FAIL" != unavailable ]] || exit 1
    if [[ "$TEST_FAIL" == rootful ]]; then printf '["name=seccomp"]';
    else printf '["name=rootless","name=seccomp"]'; fi ;;
  *" config "*) [[ "$TEST_FAIL" != config ]] ;;
  *" pull "*) [[ "$TEST_FAIL" != pull ]] ;;
  *" run "*) [[ "$TEST_FAIL" != validation ]] ;;
  *" stop "*) touch "$TEST_ROOT/stopped" ;;
  *" up "*) [[ "$TEST_FAIL" != health ]] ;;
esac
`,
    { mode: 0o755 }
  );
  try {
    const result = spawnSync('bash', [resolve('.github/deploy.sh')], {
      cwd: root,
      env: {
        ...process.env,
        DOCKER_CONTEXT: 'default',
        DOCKER_HOST: 'unix:///var/run/docker.sock',
        PATH: `${root}/bin:${process.env.PATH}`,
        TEST_ROOT: root,
        TEST_FAIL: fail
      },
      encoding: 'utf8'
    });
    return {
      status: result.status,
      stderr: result.stderr,
      calls: existsSync(join(root, 'calls'))
        ? readFileSync(join(root, 'calls'), 'utf8')
        : '',
      stopped: existsSync(join(root, 'stopped')),
      data: readFileSync(join(root, 'data/bot.sqlite'), 'utf8')
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('Compose deployment', () => {
  test('pulls and validates before stopping, then waits for health', () => {
    const result = deploy();
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls.indexOf(' pull')).toBeLessThan(
      result.calls.indexOf(' stop')
    );
    expect(result.calls.indexOf(' run')).toBeLessThan(
      result.calls.indexOf(' stop')
    );
    expect(result.calls).toContain(
      'up --detach --no-build --wait --wait-timeout 300'
    );
    expect(result.data).toBe('existing database');
  });

  test('selects the rootless context for every Docker command', () => {
    const result = deploy();
    expect(result.status, result.stderr).toBe(0);
    const calls = result.calls.trim().split('\n');
    expect(calls.every((call) => call.startsWith('--context rootless '))).toBe(
      true
    );
    expect(calls[0]).toContain('info --format');
  });

  test.each([
    'unavailable',
    'rootful'
  ])('a %s Docker daemon cannot start a deployment', (failure) => {
    const result = deploy(failure);
    expect(result.status).not.toBe(0);
    expect(result.calls).not.toContain(' compose ');
    expect(result.stopped).toBe(false);
    expect(result.data).toBe('existing database');
  });

  test.each([
    'config',
    'pull',
    'validation'
  ])('a %s failure leaves the running bot and data intact', (failure) => {
    const result = deploy(failure);
    expect(result.status).not.toBe(0);
    expect(result.stopped).toBe(false);
    expect(result.data).toBe('existing database');
  });

  test('a health failure reports diagnostics without rollback', () => {
    const result = deploy('health');
    expect(result.status).not.toBe(0);
    expect(result.stopped).toBe(true);
    expect(result.calls).toContain('ps --all');
    expect(result.calls).toContain('logs --no-color --tail=100');
    expect(result.calls.match(/ up /g)).toHaveLength(1);
    expect(result.calls).not.toContain(' down');
    expect(result.data).toBe('existing database');
  });
});
