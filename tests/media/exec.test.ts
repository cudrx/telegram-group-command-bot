import { describe, expect, test, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn()
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock
}));

describe('execMediaFileDefault', () => {
  test('maps timeoutMs to execFile timeout without leaking wrapper options', async () => {
    execFileMock.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (
          error: Error | null,
          result: { stdout: string; stderr: string }
        ) => void
      ) => callback(null, { stdout: 'ok', stderr: '' })
    );
    const { execMediaFileDefault } = await import('../../src/media/exec.js');

    await expect(
      execMediaFileDefault('yt-dlp', ['--version'], {
        cwd: '/tmp',
        maxBuffer: 123,
        timeoutMs: 456
      })
    ).resolves.toEqual({ stdout: 'ok', stderr: '' });

    expect(execFileMock).toHaveBeenCalledWith(
      'yt-dlp',
      ['--version'],
      {
        cwd: '/tmp',
        maxBuffer: 123,
        timeout: 456
      },
      expect.any(Function)
    );
  });
});
