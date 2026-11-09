import type { StoredMessage } from '../../domain/models.js';

export type PromptMessage = Pick<
  StoredMessage,
  'messageId' | 'userId' | 'senderDisplayName' | 'text' | 'createdAt' | 'isBot'
> &
  Partial<Pick<StoredMessage, 'replyToMessageId' | 'generationKind'>>;

export type DescribeMediaContext = {
  sourceCaption: string | null;
  visionDescription: string | null;
  ocrTextRu: string | null;
  ocrTextDefault: string | null;
  visionRaw: string | null;
  visionInterpretation: string | null;
  audioTranscript: {
    transcript: string;
    language: string | null;
    sourceDurationSeconds: number | null;
  } | null;
};
