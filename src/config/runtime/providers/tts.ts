export const ttsProviderConfig = {
  yandexSpeechKit: {
    provider: 'yandex_speechkit',
    model: 'speechkit-v1',
    format: 'oggopus',
    voice: 'zahar',
    emotion: 'good',
    speed: '1.1',
    lang: 'ru-RU',
    endpoint: 'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize',
    mimeType: 'audio/ogg'
  }
} as const;
