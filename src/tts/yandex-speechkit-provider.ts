import { ttsProviderConfig } from '../config/runtime/index.js';
import type { TextToSpeechProvider } from './types.js';

export const YANDEX_TTS_PROVIDER = ttsProviderConfig.yandexSpeechKit.provider;
export const YANDEX_TTS_PROVIDER_MODEL =
  ttsProviderConfig.yandexSpeechKit.model;
export const YANDEX_TTS_FORMAT = ttsProviderConfig.yandexSpeechKit.format;
export const YANDEX_TTS_VOICE = ttsProviderConfig.yandexSpeechKit.voice;
export const YANDEX_TTS_EMOTION = ttsProviderConfig.yandexSpeechKit.emotion;
export const YANDEX_TTS_SPEED = ttsProviderConfig.yandexSpeechKit.speed;

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
      lang: ttsProviderConfig.yandexSpeechKit.lang,
      voice: YANDEX_TTS_VOICE,
      emotion: YANDEX_TTS_EMOTION,
      speed: YANDEX_TTS_SPEED,
      format: YANDEX_TTS_FORMAT
    });

    try {
      const response = await fetchImpl(
        ttsProviderConfig.yandexSpeechKit.endpoint,
        {
          method: 'POST',
          headers: {
            Authorization: `Api-Key ${this.options.apiKey}`
          },
          body,
          signal: controller.signal
        }
      );

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
        mimeType: ttsProviderConfig.yandexSpeechKit.mimeType
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
