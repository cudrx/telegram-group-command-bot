export const MEDIA_OPERATIONS = {
  metadata: 'yt-dlp',
  download: 'yt-dlp',
  probe: 'ffprobe',
  normalize: 'ffmpeg',
  extractAudio: 'ffmpeg',
  gallery: 'gallery-dl'
} as const;

export type MediaOperation = keyof typeof MEDIA_OPERATIONS;
export type MediaTool = (typeof MEDIA_OPERATIONS)[MediaOperation];
export type MediaResult = { stdout: string; stderr: string };
export type MediaJobRequest = {
  id: string;
  operation: MediaOperation;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  maxBuffer: number;
};
export type MediaJobState =
  | { status: 'running' }
  | { status: 'succeeded'; result: MediaResult }
  | {
      status: 'failed';
      error: string;
      code: number | string | null;
      stdout: string;
      stderr: string;
    };

export const MEDIA_JOB_TIMEOUT_MS = 300_000;
export const MEDIA_JOB_MAX_BUFFER = 64 * 1024 * 1024;

export function isMediaOperation(value: string): value is MediaOperation {
  return Object.hasOwn(MEDIA_OPERATIONS, value);
}
