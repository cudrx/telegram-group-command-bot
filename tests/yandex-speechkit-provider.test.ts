import { describe, expect, test, vi } from 'vitest';

import { YandexSpeechKitTtsProvider } from '../src/tts/yandex-speechkit-provider.js';

describe('YandexSpeechKitTtsProvider', () => {
  test('synthesizes oggopus voice bytes through SpeechKit v1', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetch = vi.fn().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'audio/ogg' }
      })
    );
    const provider = new YandexSpeechKitTtsProvider({
      apiKey: 'key',
      fetch
    });

    const result = await provider.synthesize({
      text: 'Привет',
      timeoutMs: 20_000
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Api-Key key'
        })
      })
    );

    const body = fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.has('folderId')).toBe(false);
    expect(body.get('text')).toBe('Привет');
    expect(body.get('lang')).toBe('ru-RU');
    expect(body.get('voice')).toBe('ermil');
    expect(body.get('speed')).toBe('1.1');
    expect(body.get('format')).toBe('oggopus');
    expect(result.audioBytes).toEqual(bytes);
    expect(result.mimeType).toBe('audio/ogg');
  });

  test('throws on non-2xx responses', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response('bad request', { status: 400 }));
    const provider = new YandexSpeechKitTtsProvider({
      apiKey: 'key',
      fetch
    });

    await expect(
      provider.synthesize({ text: 'Привет', timeoutMs: 20_000 })
    ).rejects.toThrow('Yandex SpeechKit request failed with status 400');
  });
});
