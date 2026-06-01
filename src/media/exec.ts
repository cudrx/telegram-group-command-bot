import {
  type ExecFileOptions,
  execFile as execFileCallback
} from 'node:child_process';
import { promisify } from 'node:util';

export const MEDIA_EXEC_MAX_BUFFER = 64 * 1024 * 1024;

export type MediaExecFile = (
  file: string,
  args: string[],
  options?: { cwd?: string | undefined; maxBuffer?: number | undefined }
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFileCallback);

export const execMediaFileDefault: MediaExecFile = async (
  file,
  args,
  options
) => {
  const result = await execFileAsync(file, args, {
    ...options,
    maxBuffer: options?.maxBuffer ?? MEDIA_EXEC_MAX_BUFFER
  } satisfies ExecFileOptions);

  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
};
