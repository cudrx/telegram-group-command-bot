import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { OcrSpaceProvider } from '../src/media/ocr-space-provider.js';

const tempDirectories: string[] = [];

describe('OcrSpaceProvider', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();

    for (const directory of tempDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('sends rus OCR request with OCREngine=2 and extracts text', async () => {
    const filePath = await createTempFixtureFile(
      'ocr-space-test-',
      'test-image.png',
      Buffer.from([0x01, 0x02, 0x03, 0x04])
    );
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const fetchStub = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });

        return jsonResponse({
          ParsedResults: [
            {
              ParsedText: 'ГОРЖУСЬ'
            }
          ],
          IsErroredOnProcessing: false,
          OCRExitCode: 1
        });
      }
    );

    const provider = new OcrSpaceProvider({
      apiKey: 'key',
      fetch: fetchStub as typeof fetch
    });

    const result = await provider.extractText({
      filePath,
      language: 'rus',
      timeoutMs: 5000
    });

    expect(result).toMatchObject({
      provider: 'ocr_space',
      providerModel: 'ocr.space/parse/image:OCREngine=2',
      text: 'ГОРЖУСЬ',
      language: 'rus'
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.ocr.space/parse/image');

    const requestBody = calls[0]?.init?.body;
    expect(requestBody).toBeInstanceOf(FormData);

    const form = requestBody as FormData;
    expect(form.get('language')).toBe('rus');
    expect(form.get('OCREngine')).toBe('2');
    expectUploadedFile(form, 'test-image.png', 'image/png');
    expect(calls[0]?.init?.headers).toMatchObject({
      apikey: 'key'
    });
  });

  test('omits language for default OCR request', async () => {
    const filePath = await createTempFixtureFile(
      'ocr-space-test-',
      'test-image.png',
      Buffer.from([0x05, 0x06, 0x07, 0x08])
    );
    const fetchStub = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;

        return jsonResponse({
          ParsedResults: [
            {
              ParsedText: 'Leon, necesito que distraigas a Kingpin'
            }
          ],
          IsErroredOnProcessing: false,
          OCRExitCode: 1
        });
      }
    );

    const provider = new OcrSpaceProvider({
      apiKey: 'key',
      fetch: fetchStub as typeof fetch
    });

    await expect(
      provider.extractText({
        filePath,
        language: null,
        timeoutMs: 5000
      })
    ).resolves.toMatchObject({
      text: 'Leon, necesito que distraigas a Kingpin',
      language: null
    });

    const requestBody = (
      fetchStub.mock.calls[0]?.[1] as RequestInit | undefined
    )?.body as FormData | undefined;

    expect(requestBody).toBeInstanceOf(FormData);
    expect((requestBody as FormData).has('language')).toBe(false);
    expect((requestBody as FormData).get('OCREngine')).toBe('2');
    expectUploadedFile(requestBody as FormData, 'test-image.png', 'image/png');
  });

  test('returns empty text for successful empty OCR response', async () => {
    const filePath = await createTempFixtureFile(
      'ocr-space-test-',
      'test-image.png',
      Buffer.from([0x09, 0x0a, 0x0b, 0x0c])
    );
    const fetchStub = vi.fn(async () =>
      jsonResponse({
        ParsedResults: [],
        IsErroredOnProcessing: false,
        OCRExitCode: 1
      })
    );

    const provider = new OcrSpaceProvider({
      apiKey: 'key',
      fetch: fetchStub as typeof fetch
    });

    await expect(
      provider.extractText({
        filePath,
        language: null,
        timeoutMs: 5000
      })
    ).resolves.toMatchObject({
      text: ''
    });
  });

  test('throws on OCR.space processing error', async () => {
    const filePath = await createTempFixtureFile(
      'ocr-space-test-',
      'test-image.png',
      Buffer.from([0x0d, 0x0e, 0x0f, 0x10])
    );
    const fetchStub = vi.fn(async () =>
      jsonResponse({
        IsErroredOnProcessing: true,
        OCRExitCode: 3,
        ErrorMessage: ['File failed validation'],
        ErrorDetails: ['Unsupported image format']
      })
    );

    const provider = new OcrSpaceProvider({
      apiKey: 'key',
      fetch: fetchStub as typeof fetch
    });

    await expect(
      provider.extractText({
        filePath,
        language: 'rus',
        timeoutMs: 5000
      })
    ).rejects.toThrow(/OCR\.space/i);
    await expect(
      provider.extractText({
        filePath,
        language: 'rus',
        timeoutMs: 5000
      })
    ).rejects.toThrow(/File failed validation/i);
    await expect(
      provider.extractText({
        filePath,
        language: 'rus',
        timeoutMs: 5000
      })
    ).rejects.toThrow(/Unsupported image format/i);
  });

  test('throws when OCRExitCode is non-successful without nested errors', async () => {
    const filePath = await createTempFixtureFile(
      'ocr-space-test-',
      'test-image.jpg',
      Buffer.from([0x11, 0x12, 0x13, 0x14])
    );
    const fetchStub = vi.fn(async () =>
      jsonResponse({
        IsErroredOnProcessing: false,
        OCRExitCode: 99,
        ParsedResults: []
      })
    );

    const provider = new OcrSpaceProvider({
      apiKey: 'key',
      fetch: fetchStub as typeof fetch
    });

    await expect(
      provider.extractText({
        filePath,
        language: null,
        timeoutMs: 5000
      })
    ).rejects.toThrow(/OCRExitCode 99/i);
  });
});

async function createTempFixtureFile(
  prefix: string,
  filename: string,
  contents: Buffer
): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirectories.push(directory);
  const filePath = path.join(directory, filename);
  await writeFile(filePath, contents);
  return filePath;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json'
    }
  });
}

function expectUploadedFile(
  form: FormData,
  filename: string,
  mimeType: string
): void {
  const uploadedFile = form.get('file');

  expect(uploadedFile).toBeInstanceOf(Blob);
  expect((uploadedFile as Blob).type).toBe(mimeType);

  if (typeof File !== 'undefined' && uploadedFile instanceof File) {
    expect(uploadedFile.name).toBe(filename);
  } else if (
    typeof uploadedFile === 'object' &&
    uploadedFile !== null &&
    'name' in uploadedFile
  ) {
    expect((uploadedFile as { name: string }).name).toBe(filename);
  }
}
