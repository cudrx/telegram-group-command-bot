import {
  type ExecFileOptions,
  execFile as execFileCallback
} from 'node:child_process';
import { promisify } from 'node:util';

export const MEDIA_EXEC_MAX_BUFFER = 64 * 1024 * 1024;

export type MediaExecOptions = {
  cwd?: string | undefined;
  maxBuffer?: number | undefined;
  timeoutMs?: number | undefined;
};

export type MediaExecFile = (
  file: string,
  args: string[],
  options?: MediaExecOptions
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFileCallback);

export const execMediaFileDefault: MediaExecFile = async (
  file,
  args,
  options
) => {
  const { timeoutMs, ...execOptions } = options ?? {};
  const result = await execFileAsync(file, args, {
    ...execOptions,
    maxBuffer: execOptions.maxBuffer ?? MEDIA_EXEC_MAX_BUFFER,
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {})
  } satisfies ExecFileOptions);

  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
};
