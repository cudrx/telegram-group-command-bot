import type { TextToSpeechProvider } from './types.js';

export const YANDEX_TTS_PROVIDER = 'yandex_speechkit';
export const YANDEX_TTS_PROVIDER_MODEL = 'speechkit-v1';
export const YANDEX_TTS_FORMAT = 'oggopus';
export const YANDEX_TTS_VOICE = 'ermil';
export const YANDEX_TTS_SPEED = '1.1';

const YANDEX_SPEECHKIT_TTS_URL =
  'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class YandexSpeechKitTtsProvider implements TextToSpeechProvider {
  constructor(
    private readonly options: {
      apiKey: string;
      fetch?: FetchLike;
    }
  ) {}

  async synthesize(input: {
    text: string;
    timeoutMs: number;
  }): ReturnType<TextToSpeechProvider['synthesize']> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    const body = new URLSearchParams({
      text: input.text,
      lang: 'ru-RU',
      voice: YANDEX_TTS_VOICE,
      speed: YANDEX_TTS_SPEED,
      format: YANDEX_TTS_FORMAT
    });

    try {
      const response = await fetchImpl(YANDEX_SPEECHKIT_TTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${this.options.apiKey}`
        },
        body,
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = (await response.text()).trim();

        throw new Error(
          `Yandex SpeechKit request failed with status ${response.status}: ${
            errorText.length > 0 ? errorText : response.statusText
          }`
        );
      }

      return {
        provider: YANDEX_TTS_PROVIDER,
        providerModel: YANDEX_TTS_PROVIDER_MODEL,
        audioBytes: new Uint8Array(await response.arrayBuffer()),
        mimeType: 'audio/ogg'
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
