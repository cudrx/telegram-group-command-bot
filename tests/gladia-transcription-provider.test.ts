import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { GladiaTranscriptionProvider } from '../src/media/gladia-transcription-provider.js';

const AUDIO_FILE_PATH = fileURLToPath(
  new URL('../data/test-audio-message.ogg', import.meta.url)
);

describe('GladiaTranscriptionProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('uploads local audio and polls transcription result', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchStub = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });

        if (url.endsWith('/v2/upload')) {
          return jsonResponse({
            audio_url: 'https://api.gladia.io/file/uploaded',
            audio_metadata: {
              audio_duration: 13.96
            }
          });
        }

        if (url.endsWith('/v2/pre-recorded')) {
          return jsonResponse({ id: 'job-1' });
        }

        if (url.endsWith('/v2/pre-recorded/job-1')) {
          return jsonResponse({
            status: 'done',
            result: {
              transcription: {
                full_transcript: 'привет'
              },
              metadata: {
                language: 'ru'
              }
            }
          });
        }

        throw new Error(`unexpected url ${url}`);
      }
    );

    const provider = new GladiaTranscriptionProvider({
      apiKey: 'key',
      fetch: fetchStub as typeof fetch,
      delay: async () => undefined
    });

    const result = await provider.transcribe({
      filePath: AUDIO_FILE_PATH,
      filename: 'test-audio-message.ogg',
      mimeType: 'audio/ogg',
      timeoutMs: 5000
    });

    expect(result).toMatchObject({
      provider: 'gladia',
      providerModel: 'gladia-v2-pre-recorded',
      artifact: {
        type: 'transcript',
        transcript: 'привет',
        language: 'ru'
      },
      sourceDurationSeconds: 13.96
    });
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.gladia.io/v2/upload',
      'https://api.gladia.io/v2/pre-recorded',
      'https://api.gladia.io/v2/pre-recorded/job-1'
    ]);

    const uploadBody = calls[0]?.init?.body;
    expect(uploadBody).toBeInstanceOf(FormData);

    const uploadedAudio = (uploadBody as FormData).get('audio');
    expect(uploadedAudio).toBeInstanceOf(Blob);
    expect((uploadedAudio as File).name).toBe('test-audio-message.ogg');
    expect((uploadedAudio as Blob).type).toBe('audio/ogg');
    expect(Buffer.from(await (uploadedAudio as Blob).arrayBuffer())).toEqual(
      await readFile(AUDIO_FILE_PATH)
    );
    expect(calls[1]?.init?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-gladia-key': 'key'
    });
  });

  test('polls the result_url returned by Gladia', async () => {
    const calls: string[] = [];
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url.endsWith('/v2/upload')) {
        return jsonResponse({
          audio_url: 'https://api.gladia.io/file/uploaded'
        });
      }

      if (url.endsWith('/v2/pre-recorded')) {
        return jsonResponse({
          id: 'job-2',
          result_url: 'https://api.gladia.io/v2/pre-recorded/custom-result'
        });
      }

      if (url === 'https://api.gladia.io/v2/pre-recorded/custom-result') {
        return jsonResponse({
          status: 'done',
          transcript: 'hello world',
          language: 'en'
        });
      }

      throw new Error(`unexpected url ${url}`);
    });

    const provider = new GladiaTranscriptionProvider({
      apiKey: 'key',
      fetch: fetchStub as typeof fetch,
      delay: async () => undefined
    });

    await expect(
      provider.transcribe({
        filePath: AUDIO_FILE_PATH,
        filename: 'test-audio-message.ogg',
        mimeType: 'audio/ogg',
        timeoutMs: 5000
      })
    ).resolves.toMatchObject({
      artifact: {
        transcript: 'hello world',
        language: 'en'
      },
      sourceDurationSeconds: null
    });

    expect(calls).toEqual([
      'https://api.gladia.io/v2/upload',
      'https://api.gladia.io/v2/pre-recorded',
      'https://api.gladia.io/v2/pre-recorded/custom-result'
    ]);
  });

  test('throws when the transcription job reports an error status', async () => {
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/v2/upload')) {
        return jsonResponse({
          audio_url: 'https://api.gladia.io/file/uploaded'
        });
      }

      if (url.endsWith('/v2/pre-recorded')) {
        return jsonResponse({ id: 'job-3' });
      }

      if (url.endsWith('/v2/pre-recorded/job-3')) {
        return jsonResponse({
          status: 'error'
        });
      }

      throw new Error(`unexpected url ${url}`);
    });

    const provider = new GladiaTranscriptionProvider({
      apiKey: 'key',
      fetch: fetchStub as typeof fetch,
      delay: async () => undefined
    });

    await expect(
      provider.transcribe({
        filePath: AUDIO_FILE_PATH,
        filename: 'test-audio-message.ogg',
        mimeType: 'audio/ogg',
        timeoutMs: 5000
      })
    ).rejects.toThrow('Gladia transcription job failed with status error.');
  });

  test('times out after exhausting polling attempts', async () => {
    const delay = vi.fn(async () => undefined);
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/v2/upload')) {
        return jsonResponse({
          audio_url: 'https://api.gladia.io/file/uploaded'
        });
      }

      if (url.endsWith('/v2/pre-recorded')) {
        return jsonResponse({ id: 'job-4' });
      }

      if (url.endsWith('/v2/pre-recorded/job-4')) {
        return jsonResponse({
          status: 'processing'
        });
      }

      throw new Error(`unexpected url ${url}`);
    });

    const provider = new GladiaTranscriptionProvider({
      apiKey: 'key',
      fetch: fetchStub as typeof fetch,
      delay,
      pollIntervalMs: 7,
      maxPollAttempts: 2
    });

    await expect(
      provider.transcribe({
        filePath: AUDIO_FILE_PATH,
        filename: 'test-audio-message.ogg',
        mimeType: 'audio/ogg',
        timeoutMs: 5000
      })
    ).rejects.toThrow(
      'Timed out waiting for Gladia transcription after 2 polling attempts.'
    );
    expect(delay).toHaveBeenCalledWith(7);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledTimes(4);
  });

  test('respects the total operation timeout while polling', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T10:00:00.000Z'));

    const delay = vi.fn(async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    });
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/v2/upload')) {
        return jsonResponse({
          audio_url: 'https://api.gladia.io/file/uploaded'
        });
      }

      if (url.endsWith('/v2/pre-recorded')) {
        return jsonResponse({ id: 'job-5' });
      }

      if (url.endsWith('/v2/pre-recorded/job-5')) {
        return jsonResponse({
          status: 'processing'
        });
      }

      throw new Error(`unexpected url ${url}`);
    });

    const provider = new GladiaTranscriptionProvider({
      apiKey: 'key',
      fetch: fetchStub as typeof fetch,
      delay,
      pollIntervalMs: 20,
      maxPollAttempts: 10
    });

    await expect(
      provider.transcribe({
        filePath: AUDIO_FILE_PATH,
        filename: 'test-audio-message.ogg',
        mimeType: 'audio/ogg',
        timeoutMs: 10
      })
    ).rejects.toThrow('Timed out waiting for Gladia transcription after 10ms.');
    expect(delay).not.toHaveBeenCalled();
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  test('throws on non-2xx HTTP responses', async () => {
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/v2/upload')) {
        return new Response('bad key', {
          status: 401,
          statusText: 'Unauthorized'
        });
      }

      throw new Error(`unexpected url ${url}`);
    });

    const provider = new GladiaTranscriptionProvider({
      apiKey: 'bad-key',
      fetch: fetchStub as typeof fetch,
      delay: async () => undefined
    });

    await expect(
      provider.transcribe({
        filePath: AUDIO_FILE_PATH,
        filename: 'test-audio-message.ogg',
        mimeType: 'audio/ogg',
        timeoutMs: 5000
      })
    ).rejects.toThrow(
      'Gladia POST https://api.gladia.io/v2/upload failed with status 401: bad key'
    );
  });
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
}
