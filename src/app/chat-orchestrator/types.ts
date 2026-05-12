import type { AppEnv } from '../../config/env/index.js';
import type { DatabaseClient } from '../../database/index.js';
import type {
  AssistantIntent,
  MediaMessageSnapshot,
  ReplyContext,
  ReplyGenerationIntent,
  StoredMessage
} from '../../domain/models.js';
import type {
  LlmReplyResult,
  LookupPlanResult
} from '../../llm/openai-compatible-client/index.js';
import type { DescribeMediaContext } from '../../llm/prompts.js';
import type { AppLogger } from '../../logging/logger.js';
import type { LookupIntent, LookupProvider } from '../../lookup/types.js';
import type {
  OcrProvider,
  SpeechToTextProvider,
  TextToSpeechProvider,
  VisionProvider
} from '../../media/types.js';
import type { TelegramChatAction } from '../typing-indicator.js';

export type BotIdentity = {
  userId: number;
  username: string | null;
  displayName: string;
};

export type SentBotMessage = {
  messageId: number;
  createdAt: string;
};

export type ReplyDispatcher = (input: {
  chatId: number;
  replyToMessageId: number;
  text: string;
}) => Promise<SentBotMessage>;

export type VoiceDispatcher = (input: {
  chatId: number;
  replyToMessageId: number;
  audioBytes: Uint8Array;
  filename: string;
  mimeType: 'audio/ogg';
}) => Promise<SentBotMessage>;

export type WeeklyDispatcher = (input: {
  chatId: number;
  text: string;
}) => Promise<SentBotMessage>;

export type MemeMediaDispatchInput = {
  chatId: number;
  replyToMessageId: number;
  caption: string;
  media:
    | { kind: 'image'; filePath: string }
    | { kind: 'animation'; filePath: string };
};

export type MemeDispatcher = (
  input: MemeMediaDispatchInput
) => Promise<SentBotMessage>;

export type LlmClient = {
  generateReply(input: {
    assistantInstructions: string;
    targetDisplayName: string;
    intent: ReplyGenerationIntent;
    currentDateTime: string;
    replyContext: ReplyContext;
    lookupContext?: import('../../lookup/types.js').LookupContext | null;
    mediaContext?: DescribeMediaContext | null;
  }): Promise<LlmReplyResult>;
  generateWeekly(input: {
    assistantInstructions: string;
    weeklyDataset: string;
  }): Promise<LlmReplyResult>;
  planLookup(input: {
    intent: LookupIntent;
    replyContext: ReplyContext;
  }): Promise<LookupPlanResult>;
};

export type ReplyRequest = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  triggerMessageId: number;
  fromDisplayName: string;
  createdAt: string;
  intent: AssistantIntent;
  replyToMessageSnapshot: StoredMessage | null;
  replyToMediaSnapshot: MediaMessageSnapshot | null;
};

export type ReplyJobRequest = Omit<ReplyRequest, 'intent'> & {
  intent: ReplyGenerationIntent;
};

export type ChatOrchestratorDeps = {
  db: DatabaseClient;
  qwen: LlmClient;
  env: AppEnv;
  lookupProvider: LookupProvider | null;
  speechToTextProvider?: SpeechToTextProvider | null;
  textToSpeechProvider?: TextToSpeechProvider | null;
  ocrProvider?: OcrProvider | null;
  visionProvider?: VisionProvider | null;
  telegramFileApi?: {
    getFile(fileId: string): Promise<{ file_path?: string | null }>;
  } | null;
  fetch?: typeof fetch | undefined;
  bot: BotIdentity;
  replyDispatcher: ReplyDispatcher;
  voiceDispatcher: VoiceDispatcher;
  weeklyDispatcher: WeeklyDispatcher;
  memeDispatcher: MemeDispatcher;
  sendChatAction: (chatId: number, action: TelegramChatAction) => Promise<void>;
  delay: (ms: number) => Promise<void>;
  logger: AppLogger;
  now: () => string;
  random: () => number;
};
