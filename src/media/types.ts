export type TranscriptArtifact = {
  type: 'transcript';
  transcript: string;
  language: string | null;
  duration: number | null;
};

export type NormalizedMediaArtifact = TranscriptArtifact;

export type OcrLanguage = 'rus' | null;

export type SpeechToTextProvider = {
  transcribe(input: {
    filePath: string;
    filename: string;
    mimeType: string;
    timeoutMs: number;
  }): Promise<{
    provider: 'gladia';
    providerModel: string;
    artifact: TranscriptArtifact;
    rawResponse: unknown;
    sourceDurationSeconds: number | null;
  }>;
};

export type VisionProvider = {
  describe(input: { filePath: string; timeoutMs: number }): Promise<{
    provider: 'cloudflare';
    providerModel: string;
    rawText: string;
    rawResponse: unknown;
  }>;
};

export type OcrProvider = {
  extractText(input: {
    filePath: string;
    language: OcrLanguage;
    timeoutMs: number;
  }): Promise<{
    provider: 'ocr_space';
    providerModel: string;
    text: string;
    language: OcrLanguage;
    rawResponse: unknown;
  }>;
};

export type { TextToSpeechProvider } from '../tts/types.js';
