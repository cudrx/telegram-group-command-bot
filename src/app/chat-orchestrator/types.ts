import type { AppEnv } from '../../config/env/index.js';
import type { DatabaseClient } from '../../database/index.js';
import type {
  AssistantIntent,
  MediaMessageSnapshot,
  ReplyContext,
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
  VisionProvider
} from '../../media/types.js';

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

export type LlmClient = {
  generateReply(input: {
    assistantInstructions: string;
    targetDisplayName: string;
    intent: AssistantIntent;
    replyContext: ReplyContext;
    lookupContext?: import('../../lookup/types.js').LookupContext | null;
    mediaContext?: DescribeMediaContext | null;
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

export type ChatOrchestratorDeps = {
  db: DatabaseClient;
  qwen: LlmClient;
  env: AppEnv;
  lookupProvider: LookupProvider | null;
  speechToTextProvider?: SpeechToTextProvider | null;
  ocrProvider?: OcrProvider | null;
  visionProvider?: VisionProvider | null;
  telegramFileApi?: {
    getFile(fileId: string): Promise<{ file_path?: string | null }>;
  } | null;
  fetch?: typeof fetch | undefined;
  bot: BotIdentity;
  replyDispatcher: ReplyDispatcher;
  sendTyping: (chatId: number) => Promise<void>;
  delay: (ms: number) => Promise<void>;
  logger: AppLogger;
  now: () => string;
  random: () => number;
};
