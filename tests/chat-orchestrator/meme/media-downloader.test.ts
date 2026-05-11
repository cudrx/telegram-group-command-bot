import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';

import { downloadMemeMediaToTemp } from '../../../src/app/chat-orchestrator/meme/media-downloader.js';

describe('downloadMemeMediaToTemp', () => {
  test('downloads a file to temp and cleans it up', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Length': '3' }
      })
    );

    const downloaded = await downloadMemeMediaToTemp({
      url: 'https://i.redd.it/a.jpeg',
      filename: 'a.jpeg',
      maxBytes: 10,
      timeoutMs: 1000,
      fetch: fetchMock
    });

    expect(await readFile(downloaded.filePath)).toEqual(Buffer.from([1, 2, 3]));

    await downloaded.cleanup();

    expect(existsSync(downloaded.filePath)).toBe(false);
  });

  test('rejects content length larger than max bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'Content-Length': '11' }
      })
    );

    await expect(
      downloadMemeMediaToTemp({
        url: 'https://i.redd.it/a.jpeg',
        filename: 'a.jpeg',
        maxBytes: 10,
        timeoutMs: 1000,
        fetch: fetchMock
      })
    ).rejects.toThrow('Media file is too large');
  });
});
