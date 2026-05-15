import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function downloadMemeMediaToTemp(input: {
  url: string;
  filename: string;
  maxBytes: number;
  timeoutMs: number;
  fetch?: typeof fetch | undefined;
}): Promise<{ filePath: string; bytes: number; cleanup: () => Promise<void> }> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const { signal, clear } = createTimeoutSignal(input.timeoutMs);
  let response: Response;

  try {
    response = await fetchImpl(input.url, { signal });
  } finally {
    clear();
  }

  if (!response.ok) {
    throw new Error(
      `Meme media download failed with status ${response.status}.`
    );
  }

  const contentLength = response.headers.get('Content-Length');

  if (contentLength) {
    assertMaxBytes(Number(contentLength), input.maxBytes);
  }

  const bytes = await readResponseBytesWithLimit(response, input.maxBytes);
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'reddit-meme-'));
  const filePath = path.join(tempDirectory, path.basename(input.filename));

  await writeFile(filePath, bytes);

  return {
    filePath,
    bytes: bytes.byteLength,
    cleanup: async () => {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  };
}

function assertMaxBytes(bytes: number, maxBytes: number): void {
  if (!Number.isFinite(bytes) || bytes > maxBytes) {
    throw new Error(`Media file is too large: ${bytes} bytes.`);
  }
}

async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertMaxBytes(bytes.byteLength, maxBytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      chunks.push(result.value);
      totalBytes += result.value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        assertMaxBytes(totalBytes, maxBytes);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  if (typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), clear: () => undefined };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
