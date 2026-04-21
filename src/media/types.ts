export type MediaKind =
  | 'photo'
  | 'document_image'
  | 'voice'
  | 'audio'
  | 'video_note';

export type TranscriptArtifact = {
  type: 'transcript';
  transcript: string;
  language: string | null;
  duration: number | null;
};

export type VisionArtifact = {
  type: 'vision';
  kind: 'photo' | 'screenshot' | 'meme' | 'document' | 'other';
  visibleText: string[];
  namesMentionedInText: string[];
  visuallyPresentPeopleOrCharacters: string[];
  objects: string[];
  scene: string;
  actions: string[];
  style: string;
  uncertainty: string[];
};

export type NormalizedMediaArtifact = TranscriptArtifact | VisionArtifact;

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
    artifact: VisionArtifact;
    rawResponse: unknown;
  }>;
};
