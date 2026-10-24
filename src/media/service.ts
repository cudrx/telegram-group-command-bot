import { copyFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type MediaProcessError, runMediaProcess } from './service-process.js';
import {
  isMediaOperation,
  MEDIA_JOB_MAX_BUFFER,
  MEDIA_JOB_TIMEOUT_MS,
  MEDIA_OPERATIONS,
  type MediaJobRequest,
  type MediaJobState,
  type MediaTool
} from './service-protocol.js';

type ServiceConfig = {
  kind: 'video' | 'gallery';
  mediaRoot: string;
  dataRoot: string;
  executables?: Partial<Record<MediaTool, string>>;
};
type Job = { state: MediaJobState; abort: AbortController; expiresAt: number };

export function createMediaService(config: ServiceConfig) {
  const jobs = new Map<string, Job>();
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      send(response, 400, { error: 'Invalid media job request' });
    });
  });

  function reap() {
    for (const [id, job] of jobs) {
      if (job.expiresAt <= Date.now()) {
        job.abort.abort();
        jobs.delete(id);
      }
    }
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    reap();
    if (request.method === 'GET' && request.url === '/health') {
      send(response, 200, { status: 'ok' });
      return;
    }

    const match = /^\/jobs\/([a-f0-9-]{36})$/.exec(request.url ?? '');
    if (match?.[1]) {
      const id = match[1];
      const job = jobs.get(id);
      if (request.method === 'DELETE') {
        job?.abort.abort();
        jobs.delete(id);
        send(response, 204);
        return;
      }

      if (request.method === 'GET') {
        send(response, job ? 200 : 404, job?.state ?? { error: 'Unknown job' });
        return;
      }
    }

    if (request.method !== 'POST' || request.url !== '/jobs') {
      send(response, 404, { error: 'Unknown route' });
      return;
    }

    const payload = await readBody(request);
    const parsed = await validateJob(payload, config);
    if (!parsed) {
      send(response, 400, {
        error: 'Invalid media operation, arguments or paths'
      });
      return;
    }

    if (jobs.has(parsed.id)) {
      send(response, 409, { error: 'Job already exists' });
      return;
    }

    // The bot already bounds its video queue; this also bounds direct API callers.
    if (
      [...jobs.values()].filter((job) => job.state.status === 'running')
        .length >= 4
    ) {
      send(response, 429, { error: 'Media worker busy' });
      return;
    }

    const job: Job = {
      state: { status: 'running' },
      abort: new AbortController(),
      expiresAt: Date.now() + parsed.timeoutMs + 60_000
    };
    jobs.set(parsed.id, job);
    send(response, 202, { id: parsed.id });
    void execute(parsed, job);
  }

  async function execute(input: MediaJobRequest, job: Job) {
    let cookieDirectory: string | undefined;
    try {
      const tool = MEDIA_OPERATIONS[input.operation];
      const args = [...input.args];
      const cookiesIndex = args.indexOf('--cookies');
      const cookies = args[cookiesIndex + 1];
      if (cookiesIndex >= 0 && cookies) {
        cookieDirectory = await mkdtemp(path.join(tmpdir(), 'media-cookies-'));
        const copy = path.join(cookieDirectory, 'cookies.txt');
        try {
          await copyFile(cookies, copy);
        } catch (error) {
          if (
            tool !== 'yt-dlp' ||
            (error as NodeJS.ErrnoException).code !== 'ENOENT'
          ) {
            throw error;
          }

          // yt-dlp accepts a missing jar and saves it at the private job path.
        }
        args[cookiesIndex + 1] = copy;
      }

      const executable = config.executables?.[tool] ?? tool;
      const result = await runMediaProcess({
        file: input.operation === 'normalize' ? 'nice' : executable,
        args:
          input.operation === 'normalize'
            ? ['-n', '19', executable, ...args]
            : args,
        cwd: input.cwd ?? config.mediaRoot,
        timeoutMs: input.timeoutMs,
        maxBuffer: input.maxBuffer,
        signal: job.abort.signal
      });
      job.state = { status: 'succeeded', result };
    } catch (error) {
      const failure = error as Partial<MediaProcessError>;
      job.state = {
        status: 'failed',
        error: failure.message ?? 'Media job failed',
        code: failure.code ?? null,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? ''
      };
    } finally {
      if (cookieDirectory)
        await rm(cookieDirectory, { recursive: true, force: true });

      job.expiresAt = Date.now() + 60_000;
    }
  }

  const reapTimer = setInterval(reap, 30_000);
  reapTimer.unref();
  return {
    server,
    async stop() {
      clearInterval(reapTimer);
      for (const job of jobs.values()) job.abort.abort();

      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  };
}

function send(response: ServerResponse, status: number, payload?: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(payload === undefined ? undefined : JSON.stringify(payload));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  request.setEncoding('utf8');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 32_768) throw new Error('Request too large');
  }

  return JSON.parse(body) as unknown;
}

async function validateJob(
  payload: unknown,
  config: ServiceConfig
): Promise<MediaJobRequest | null> {
  if (typeof payload !== 'object' || payload === null) return null;

  const value = payload as Record<string, unknown>;
  if (typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id))
    return null;
  if (typeof value.operation !== 'string' || !isMediaOperation(value.operation))
    return null;
  if ((value.operation === 'gallery') !== (config.kind === 'gallery'))
    return null;
  if (
    !Array.isArray(value.args) ||
    !value.args.every((arg) => typeof arg === 'string' && !arg.includes('\0'))
  )
    return null;
  if (
    value.args.some((arg: string) =>
      /^(--exec|--config|--plugin|--external-downloader|--use-postprocessor)/.test(
        arg
      )
    )
  )
    return null;
  if (
    typeof value.timeoutMs !== 'number' ||
    !Number.isInteger(value.timeoutMs) ||
    value.timeoutMs <= 0 ||
    value.timeoutMs > MEDIA_JOB_TIMEOUT_MS
  )
    return null;
  if (
    typeof value.maxBuffer !== 'number' ||
    !Number.isInteger(value.maxBuffer) ||
    value.maxBuffer <= 0 ||
    value.maxBuffer > MEDIA_JOB_MAX_BUFFER
  )
    return null;

  const cwd = value.cwd ?? config.mediaRoot;
  if (typeof cwd !== 'string' || !within(cwd, config.mediaRoot)) return null;
  if (!within(await realpath(cwd), await realpath(config.mediaRoot)))
    return null;

  const args = value.args as string[];
  for (const [index, arg] of args.entries()) {
    const cookie = args[index - 1] === '--cookies';
    if (cookie) {
      if (!within(arg, config.dataRoot)) return null;
      let resolvedCookie: string;
      try {
        resolvedCookie = await realpath(arg);
      } catch (error) {
        if (
          MEDIA_OPERATIONS[value.operation] !== 'yt-dlp' ||
          (error as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          throw error;
        }

        resolvedCookie = path.join(
          await realpath(path.dirname(arg)),
          path.basename(arg)
        );
      }
      if (!within(resolvedCookie, await realpath(config.dataRoot))) return null;
    } else if (path.isAbsolute(arg) && !within(arg, config.mediaRoot))
      return null;
  }

  return {
    id: value.id,
    operation: value.operation,
    args,
    cwd,
    timeoutMs: value.timeoutMs,
    maxBuffer: value.maxBuffer
  };
}

function within(candidate: string, root: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}
