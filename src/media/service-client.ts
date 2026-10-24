import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { MediaExecFile } from './exec.js';
import {
  MEDIA_JOB_MAX_BUFFER,
  MEDIA_JOB_TIMEOUT_MS,
  type MediaJobState,
  type MediaOperation
} from './service-protocol.js';

export function createRemoteMediaExec(input: {
  videoUrl: string;
  galleryUrl: string;
  pollMs?: number;
}): MediaExecFile {
  return async (file, originalArgs, options) => {
    const args = file === 'nice' ? originalArgs.slice(3) : originalArgs;
    const tool = file === 'nice' ? originalArgs[2] : file;
    let operation: MediaOperation;
    switch (tool) {
      case 'yt-dlp':
        operation = args.includes('--dump-single-json')
          ? 'metadata'
          : 'download';
        break;
      case 'gallery-dl':
        operation = 'gallery';
        break;
      case 'ffprobe':
        operation = 'probe';
        break;
      case 'ffmpeg':
        operation = args.includes('-vn') ? 'extractAudio' : 'normalize';
        break;
      default:
        throw new Error(`Unsupported media tool: ${file}`);
    }
    const base = (
      operation === 'gallery' ? input.galleryUrl : input.videoUrl
    ).replace(/\/$/, '');
    const id = randomUUID();
    const timeoutMs = options?.timeoutMs ?? MEDIA_JOB_TIMEOUT_MS;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetch(`${base}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          id,
          operation,
          args,
          ...options,
          timeoutMs,
          maxBuffer: options?.maxBuffer ?? MEDIA_JOB_MAX_BUFFER
        })
      });
      if (!response.ok)
        throw new Error(`Media service rejected job: HTTP ${response.status}`);

      while (true) {
        const result = await fetch(`${base}/jobs/${id}`, { signal });
        if (!result.ok)
          throw new Error(`Media service lost job: HTTP ${result.status}`);

        const state = (await result.json()) as MediaJobState;
        if (state.status === 'succeeded') return state.result;
        if (state.status === 'failed')
          throw Object.assign(new Error(`${state.error}\n${state.stderr}`), {
            code: state.code,
            stdout: state.stdout,
            stderr: state.stderr
          });

        await delay(input.pollMs ?? 250, undefined, { signal });
      }
    } catch (error) {
      if (signal.aborted)
        throw new Error('Media job timeout', { cause: error });

      throw error;
    } finally {
      // Cancellation also kills subprocesses; no local fallback after HTTP failure.
      await fetch(`${base}/jobs/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5_000)
      }).catch(() => {});
    }
  };
}
