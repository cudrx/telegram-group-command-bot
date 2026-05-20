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
  AnalyzeNewsInput,
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
import type { YtDlpExecFile } from '../actions/meme/yt-dlp-client.js';
import type { TelegramChatAction } from '../typing-indicator.js';

export type BotIdentity = {
  userId: number;
  username: string | null;
  displayName: string;
};

export type SentBotMessage = {
  messageId: number;
  createdAt: string;
  mediaSnapshot?: MediaMessageSnapshot | null;
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

export type MemeMediaDispatchInput = {
  chatId: number;
  replyToMessageId: number;
  caption: string;
  media: { kind: 'image' | 'video'; filePath: string };
};

export type MemeDispatcher = (
  input: MemeMediaDispatchInput
) => Promise<SentBotMessage>;

export type CopiedBotMessage = {
  messageId: number;
};

export type CopyMessageDispatcher = (input: {
  targetChatId: number;
  sourceChatId: number;
  messageId: number;
}) => Promise<CopiedBotMessage>;

export type CopyMessagesDispatcher = (input: {
  targetChatId: number;
  sourceChatId: number;
  messageIds: number[];
}) => Promise<CopiedBotMessage[]>;

export type DeleteMessageDispatcher = (input: {
  chatId: number;
  messageId: number;
}) => Promise<void>;

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
  planLookup(input: {
    intent: LookupIntent;
    replyContext: ReplyContext;
  }): Promise<LookupPlanResult>;
  analyzeNews(input: AnalyzeNewsInput): Promise<LlmReplyResult>;
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
  execFile?: YtDlpExecFile | undefined;
  bot: BotIdentity;
  replyDispatcher: ReplyDispatcher;
  voiceDispatcher: VoiceDispatcher;
  memeDispatcher: MemeDispatcher;
  copyMessageDispatcher: CopyMessageDispatcher;
  copyMessagesDispatcher: CopyMessagesDispatcher;
  deleteMessageDispatcher: DeleteMessageDispatcher;
  sendChatAction: (chatId: number, action: TelegramChatAction) => Promise<void>;
  delay: (ms: number) => Promise<void>;
  logger: AppLogger;
  now: () => string;
  random: () => number;
};
