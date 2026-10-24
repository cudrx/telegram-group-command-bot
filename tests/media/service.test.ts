import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createMediaService } from '../../src/media/service.js';
import {
  createRemoteMediaExec,
  waitForMediaServices
} from '../../src/media/service-client.js';

let root: string;
let url: string;
let service: ReturnType<typeof createMediaService>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'media-service-test-'));
  const executable = join(root, 'fake-tool');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
const url = args.at(-1);
if (url === 'fixture:fail') {
  console.error('login required');
  process.exit(3);
}
if (url === 'fixture:hang') {
  fs.writeFileSync('started', 'yes');
  spawn(process.execPath, ['-e', "setTimeout(() => require('node:fs').writeFileSync('orphan', 'bad'), 600)"], { stdio: 'ignore' });
  setInterval(() => {}, 1000);
} else if (url === 'fixture:large') {
  console.log('x'.repeat(10000));
} else {
  const cookies = args.indexOf('--cookies');
  const cookie = cookies < 0 || !fs.existsSync(args[cookies + 1]) ? null : fs.readFileSync(args[cookies + 1], 'utf8');
  if (cookies >= 0) fs.writeFileSync(args[cookies + 1], 'updated cookie');
  fs.writeFileSync('result.mp4', 'video bytes');
  console.log(JSON.stringify({ cookie, args }));
}
`,
    { mode: 0o755 }
  );
  service = createMediaService({
    kind: 'video',
    mediaRoot: root,
    dataRoot: root,
    executables: {
      'yt-dlp': executable,
      ffmpeg: executable,
      ffprobe: executable
    }
  });
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  url = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await service.stop();
  await rm(root, { recursive: true, force: true });
});

function client() {
  return createRemoteMediaExec({ videoUrl: url, galleryUrl: url, pollMs: 10 });
}

describe('media service over HTTP', () => {
  test('retries unhealthy workers until both are ready', async () => {
    let requests = 0;
    const gallery = createServer((_request, response) => {
      response.writeHead(++requests === 1 ? 503 : 200).end();
    });
    gallery.listen(0, '127.0.0.1');
    await once(gallery, 'listening');
    try {
      await waitForMediaServices({
        videoUrl: url,
        galleryUrl: `http://127.0.0.1:${(gallery.address() as AddressInfo).port}`,
        pollMs: 10,
        timeoutMs: 1000
      });
      expect(requests).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => {
        gallery.close(() => resolve());
        gallery.closeAllConnections();
      });
    }
  });

  test('bounds startup wait even if a worker accepts connections without responding', async () => {
    const gallery = createServer(() => {});
    gallery.listen(0, '127.0.0.1');
    await once(gallery, 'listening');
    try {
      await expect(
        waitForMediaServices({
          videoUrl: url,
          galleryUrl: `http://127.0.0.1:${(gallery.address() as AddressInfo).port}`,
          pollMs: 10,
          timeoutMs: 100
        })
      ).rejects.toThrow(/startup timeout/);
    } finally {
      await new Promise<void>((resolve) => {
        gallery.close(() => resolve());
        gallery.closeAllConnections();
      });
    }
  });

  test('allows yt-dlp to create a private cookie jar when operator cookies are absent', async () => {
    const cookies = join(root, 'missing-cookies.txt');
    const result = await client()(
      'yt-dlp',
      ['--cookies', cookies, '--dump-single-json', 'fixture:ok'],
      { cwd: root }
    );
    expect(JSON.parse(result.stdout).cookie).toBeNull();
    await expect(readFile(cookies)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('preserves UTF-8 arguments split between HTTP chunks', async () => {
    const id = randomUUID();
    const source = 'fixture:Привет';
    const body = Buffer.from(
      JSON.stringify({
        id,
        operation: 'metadata',
        args: ['--dump-single-json', source],
        cwd: root,
        timeoutMs: 1000,
        maxBuffer: 1024
      })
    );
    const split = body.indexOf(Buffer.from('П')) + 1;
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        `${url}/jobs`,
        { method: 'POST' },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        }
      );
      request.on('error', reject);
      request.write(body.subarray(0, split));
      setTimeout(() => request.end(body.subarray(split)), 40);
    });
    expect(status).toBe(202);
    let result: { status: string; result?: { stdout: string } } | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      result = await (await fetch(`${url}/jobs/${id}`)).json();
      if (result?.status !== 'running') break;
      await delay(10);
    }
    expect(result?.status).toBe('succeeded');
    expect(JSON.parse(result?.result?.stdout ?? '{}').args).toEqual([
      '--dump-single-json',
      source
    ]);
  });

  test('returns CLI JSON and shares produced files with the bot', async () => {
    const result = await client()(
      'yt-dlp',
      ['--dump-single-json', 'fixture:ok'],
      { cwd: root }
    );
    expect(JSON.parse(result.stdout)).toEqual({
      cookie: null,
      args: ['--dump-single-json', 'fixture:ok']
    });
    expect(await readFile(join(root, 'result.mp4'), 'utf8')).toBe(
      'video bytes'
    );
  });

  test('copies cookies per job and preserves the operator cookie file', async () => {
    const cookies = join(root, 'cookies.txt');
    await writeFile(cookies, 'original cookie');
    const result = await client()(
      'yt-dlp',
      ['--cookies', cookies, '--dump-single-json', 'fixture:ok'],
      { cwd: root }
    );
    expect(JSON.parse(result.stdout).cookie).toBe('original cookie');
    expect(await readFile(cookies, 'utf8')).toBe('original cookie');
  });

  test('preserves stderr for Instagram source-lock detection', async () => {
    await expect(
      client()('yt-dlp', ['--dump-single-json', 'fixture:fail'], { cwd: root })
    ).rejects.toMatchObject({ code: 3, stderr: 'login required\n' });
  });

  test('routes nice ffmpeg through the normalization operation', async () => {
    await client()(
      'nice',
      ['-n', '19', 'ffmpeg', '-i', 'input.mp4', 'output.mp4'],
      { cwd: root }
    );
    expect(await readFile(join(root, 'result.mp4'), 'utf8')).toBe(
      'video bytes'
    );
  });

  test('enforces the caller output limit', async () => {
    await expect(
      client()('yt-dlp', ['--dump-single-json', 'fixture:large'], {
        cwd: root,
        maxBuffer: 128
      })
    ).rejects.toThrow(/output/i);
  });

  test('cancels the process group on timeout, including ffmpeg descendants', async () => {
    const result = client()('yt-dlp', ['--dump-single-json', 'fixture:hang'], {
      cwd: root,
      timeoutMs: 250
    });
    await expect(result).rejects.toThrow(/timeout/i);
    expect(await readFile(join(root, 'started'), 'utf8')).toBe('yes');
    await delay(750);
    await expect(readFile(join(root, 'orphan'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  test.each([
    { operation: 'shell', args: ['id'], cwd: root },
    { operation: 'gallery', args: ['--resolve-json', 'fixture:ok'] },
    { operation: 'metadata', args: ['--exec', 'id', 'fixture:ok'] },
    {
      operation: 'metadata',
      args: ['--dump-single-json', 'fixture:ok'],
      cwd: '/etc'
    },
    { operation: 'metadata', args: ['--cookies', '/etc/passwd', 'fixture:ok'] }
  ])('rejects unsupported operations and paths: %j', async (payload) => {
    const response = await fetch(`${url}/jobs`, {
      method: 'POST',
      body: JSON.stringify({
        id: randomUUID(),
        timeoutMs: 1000,
        maxBuffer: 1024,
        ...payload
      })
    });
    expect(response.status).toBe(400);
  });
});
