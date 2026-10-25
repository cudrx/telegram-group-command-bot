import { spawn } from 'node:child_process';
import type { MediaResult } from './service-protocol.js';

export type MediaProcessError = Error & {
  code: string | number | null;
  stdout: string;
  stderr: string;
};

export function runMediaProcess(input: {
  file: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxBuffer: number;
  signal: AbortSignal;
}): Promise<MediaResult> {
  return new Promise((resolve, reject) => {
    input.signal.throwIfAborted();
    const child = spawn(input.file, input.args, {
      cwd: input.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let failure: string | undefined;
    const kill = () => {
      if (!child.pid) return;

      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    const abort = () => {
      failure = 'Media job cancelled';
      kill();
    };
    input.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      failure = 'Media job timeout';
      kill();
    }, input.timeoutMs);
    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > input.maxBuffer) {
        failure = 'Media output limit exceeded';
        kill();
        return;
      }

      target.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.on('error', (error) => {
      failure = error.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      input.signal.removeEventListener('abort', abort);
      kill();
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      };
      if (failure || code !== 0) {
        reject(
          Object.assign(
            new Error(failure ?? `Media command failed: ${result.stderr}`),
            {
              ...result,
              code
            }
          )
        );
        return;
      }

      resolve(result);
    });
  });
}
