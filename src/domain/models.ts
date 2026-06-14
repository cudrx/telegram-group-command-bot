import type { ChatPolicy } from '../config/env/types.js';

export type ChatType =
  | 'private'
  | 'group'
  | 'supergroup'
  | 'channel'
  | 'unknown';

export type AuthorizedMode = 'chat' | 'private_admin' | 'private_link_sender';

export type AccessContext =
  | { kind: 'configured_chat'; policy: ChatPolicy }
  | { kind: 'private_admin' }
  | { kind: 'private_link_sender' }
  | { kind: 'unauthorized' };

export type AssistantIntent =
  | 'summarize'
  | 'decide'
  | 'read'
  | 'transcribe'
  | 'answer'
  | 'translate'
  | 'meme'
  | 'sex';

export type ReplyGenerationIntent = Exclude<
  AssistantIntent,
  'meme' | 'sex' | 'transcribe'
>;

export type BotOutputMode = 'text' | 'voice';

export type NormalizedMessage = {
  chatId: number;
  chatType: ChatType;
  authorizedMode?: AuthorizedMode;
  accessContext?: AccessContext;
  chatTitle: string | null;
  messageId: number;
  mediaGroupId?: string | null;
  text: string;
  createdAt: string;
  fromUserId: number | null;
  fromUsername: string | null;
  fromFirstName: string | null;
  fromLastName: string | null;
  fromDisplayName: string;
  isBot: boolean;
  entities: Array<{ type: string; offset: number; length: number }>;
  replyToUserId: number | null;
  replyToMessageId: number | null;
  replyToMessageSnapshot: StoredMessage | null;
  replyToMediaSnapshot: MediaMessageSnapshot | null;
  mediaSnapshot: MediaMessageSnapshot | null;
};

export type MediaMessageSnapshot = {
  messageId: number;
  mediaKind:
    | 'photo'
    | 'document_image'
    | 'voice'
    | 'audio'
    | 'video'
    | 'video_note';
  fileId: string;
  fileUniqueId: string | null;
  mimeType: string | null;
  fileSize: number | null;
  durationSeconds: number | null;
  caption: string | null;
};

export type StoredMessage = {
  chatId: number;
  messageId: number;
  mediaGroupId?: string | null;
  userId: number | null;
  senderDisplayName: string;
  text: string;
  createdAt: string;
  editedAt?: string | null;
  isBot: boolean;
  outputMode?: BotOutputMode;
  replyToMessageId: number | null;
  mediaSnapshot?: MediaMessageSnapshot | null;
};

export type ReplyContext = {
  triggerMessage: StoredMessage | null;
  replyAnchorMessage: StoredMessage | null;
  priorContextMessages: StoredMessage[];
};

export type ChatState = {
  chatId: number;
  chatType: ChatType;
  title: string | null;
  lastMessageAt: string | null;
  lastBotMessageAt: string | null;
  answerLastOutputMode: BotOutputMode | null;
  answerEligibleTextSinceVoice: number;
  answerEligibleTextStreak: number;
  readLastVoiceAt: string | null;
  readTtsVoiceCount: number;
};
