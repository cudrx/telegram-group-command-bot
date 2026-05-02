export type TextToSpeechProvider = {
  synthesize(input: { text: string; timeoutMs: number }): Promise<{
    provider: 'yandex_speechkit';
    providerModel: string;
    audioBytes: Uint8Array;
    mimeType: 'audio/ogg';
  }>;
};
