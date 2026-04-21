import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { loadPrompt } from '../src/llm/prompt-files.js';
import { CloudflareVisionProvider } from '../src/media/cloudflare-vision-provider.js';

const tempDirectories: string[] = [];

describe('CloudflareVisionProvider', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();

    for (const directory of tempDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('sends image bytes and normalizes a Cloudflare object response', async () => {
    const imageFilePath = await createTempFixtureFile(
      'cloudflare-vision-test-',
      'test-image.jpeg',
      Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x02, 0x03, 0xff, 0xd9
      ])
    );
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const fetchStub = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });

        return jsonResponse({
          success: true,
          result: {
            response: {
              kind: 'screenshot',
              visible_text: ['Leon, necesito que distraigas a Kingpin'],
              names_mentioned_in_text: ['Leon', 'Kingpin'],
              visually_present_people_or_characters: ['Man in black mask'],
              objects: ['Light fixtures'],
              scene: 'Indoor setting',
              actions: ['standing'],
              style: 'Dark and moody',
              uncertainty: ['context']
            }
          },
          errors: []
        });
      }
    );

    const provider = new CloudflareVisionProvider({
      accountId: 'account',
      apiKey: 'key',
      fetch: fetchStub as typeof fetch
    });

    const result = await provider.describe({
      filePath: imageFilePath,
      timeoutMs: 5000
    });

    const imageBytes = [...(await readFile(imageFilePath))];

    expect(result).toMatchObject({
      provider: 'cloudflare',
      providerModel: '@cf/meta/llama-3.2-11b-vision-instruct',
      artifact: {
        type: 'vision',
        kind: 'screenshot',
        namesMentionedInText: ['Leon', 'Kingpin'],
        visuallyPresentPeopleOrCharacters: ['Man in black mask']
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/account/ai/run/@cf/meta/llama-3.2-11b-vision-instruct'
    );

    const requestBody = JSON.parse(String(calls[0]?.init?.body)) as {
      messages: Array<{ role: string; content: string }>;
      image: number[];
      max_tokens: number;
      temperature: number;
    };

    expect(requestBody.image).toEqual(imageBytes);
    expect(requestBody.max_tokens).toBe(700);
    expect(requestBody.temperature).toBe(0);
    expect(requestBody.messages).toEqual([
      { role: 'system', content: loadPrompt('cloudflareVisionSystem') },
      { role: 'user', content: loadPrompt('cloudflareVisionUser') }
    ]);
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer key',
      'content-type': 'application/json'
    });
  });

  test('normalizes a Cloudflare JSON string response body', async () => {
    const imageFilePath = await createTempFixtureFile(
      'cloudflare-vision-test-',
      'test-image.jpeg',
      Buffer.from([0x01, 0x02, 0x03])
    );
    const fetchStub = vi.fn(async () =>
      jsonResponse({
        success: true,
        result: {
          response: JSON.stringify({
            kind: 'meme',
            visible_text: ['CAPTION'],
            names_mentioned_in_text: ['CAPTION'],
            visually_present_people_or_characters: ['smiling person'],
            objects: ['phone'],
            scene: 'outdoors',
            actions: ['holding phone'],
            style: 'bright',
            uncertainty: []
          })
        },
        errors: []
      })
    );

    const provider = new CloudflareVisionProvider({
      accountId: 'account',
      apiKey: 'key',
      fetch: fetchStub as typeof fetch
    });

    await expect(
      provider.describe({
        filePath: imageFilePath,
        timeoutMs: 5000
      })
    ).resolves.toMatchObject({
      artifact: {
        type: 'vision',
        kind: 'meme',
        visibleText: ['CAPTION'],
        namesMentionedInText: ['CAPTION'],
        visuallyPresentPeopleOrCharacters: ['smiling person'],
        objects: ['phone'],
        scene: 'outdoors',
        actions: ['holding phone'],
        style: 'bright',
        uncertainty: []
      }
    });
  });

  test('uses the top-level response body when result.response is absent', async () => {
    const imageFilePath = await createTempFixtureFile(
      'cloudflare-vision-test-',
      'test-image.jpeg',
      Buffer.from([0x04, 0x05, 0x06])
    );
    const fetchStub = vi.fn(async () =>
      jsonResponse({
        success: true,
        kind: 'photo',
        visible_text: ['top-level'],
        names_mentioned_in_text: ['top-level name'],
        visually_present_people_or_characters: ['person'],
        objects: ['chair'],
        scene: 'room',
        actions: ['standing'],
        style: 'neutral',
        uncertainty: ['could be indoors']
      })
    );

    const provider = new CloudflareVisionProvider({
      accountId: 'account',
      apiKey: 'key',
      fetch: fetchStub as typeof fetch
    });

    await expect(
      provider.describe({
        filePath: imageFilePath,
        timeoutMs: 5000
      })
    ).resolves.toMatchObject({
      artifact: {
        kind: 'photo',
        visibleText: ['top-level'],
        namesMentionedInText: ['top-level name']
      }
    });
  });

  test('throws when Cloudflare reports success=false', async () => {
    const imageFilePath = await createTempFixtureFile(
      'cloudflare-vision-test-',
      'test-image.jpeg',
      Buffer.from([0x07, 0x08, 0x09])
    );
    const fetchStub = vi.fn(async () =>
      jsonResponse({
        success: false,
        errors: [{ message: 'model unavailable', code: 1001 }]
      })
    );

    const provider = new CloudflareVisionProvider({
      accountId: 'account',
      apiKey: 'key',
      fetch: fetchStub as typeof fetch
    });

    await expect(
      provider.describe({
        filePath: imageFilePath,
        timeoutMs: 5000
      })
    ).rejects.toThrow(/success=false/i);
    await expect(
      provider.describe({
        filePath: imageFilePath,
        timeoutMs: 5000
      })
    ).rejects.toThrow(/model unavailable/i);
  });

  test('throws on non-2xx HTTP responses', async () => {
    const imageFilePath = await createTempFixtureFile(
      'cloudflare-vision-test-',
      'test-image.jpeg',
      Buffer.from([0x0a, 0x0b, 0x0c])
    );
    const fetchStub = vi.fn(
      async () =>
        new Response('bad key', {
          status: 401,
          statusText: 'Unauthorized'
        })
    );

    const provider = new CloudflareVisionProvider({
      accountId: 'account',
      apiKey: 'bad-key',
      fetch: fetchStub as typeof fetch
    });

    await expect(
      provider.describe({
        filePath: imageFilePath,
        timeoutMs: 5000
      })
    ).rejects.toThrow(
      'Cloudflare vision request failed with status 401: bad key'
    );
  });

  test('throws on invalid JSON responses', async () => {
    const imageFilePath = await createTempFixtureFile(
      'cloudflare-vision-test-',
      'test-image.jpeg',
      Buffer.from([0x0d, 0x0e, 0x0f])
    );
    const fetchStub = vi.fn(async () => new Response('not json'));

    const provider = new CloudflareVisionProvider({
      accountId: 'account',
      apiKey: 'key',
      fetch: fetchStub as typeof fetch
    });

    await expect(
      provider.describe({
        filePath: imageFilePath,
        timeoutMs: 5000
      })
    ).rejects.toThrow('Cloudflare vision request returned invalid JSON.');
  });

  test('throws on empty 2xx responses', async () => {
    const imageFilePath = await createTempFixtureFile(
      'cloudflare-vision-test-',
      'test-image.jpeg',
      Buffer.from([0x10, 0x11, 0x12])
    );
    const fetchStub = vi.fn(async () => new Response(''));

    const provider = new CloudflareVisionProvider({
      accountId: 'account',
      apiKey: 'key',
      fetch: fetchStub as typeof fetch
    });

    await expect(
      provider.describe({
        filePath: imageFilePath,
        timeoutMs: 5000
      })
    ).rejects.toThrow('Cloudflare vision request returned an empty response.');
  });
});

async function createTempFixtureFile(
  directoryPrefix: string,
  filename: string,
  bytes: Buffer
): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), directoryPrefix));
  tempDirectories.push(directory);
  const filePath = path.join(directory, filename);
  await writeFile(filePath, bytes);

  return filePath;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
}
