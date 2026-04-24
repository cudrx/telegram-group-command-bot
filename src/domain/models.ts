export type ChatType =
  | 'private'
  | 'group'
  | 'supergroup'
  | 'channel'
  | 'unknown';

export type AuthorizedMode = 'chat' | 'private_admin';

export type AssistantIntent = 'summarize' | 'decide' | 'read' | 'answer';

export type DirectTrigger =
  | {
      kind: 'command';
      intent: AssistantIntent;
      commandText: string;
    }
  | { kind: 'none' };

export type NormalizedMessage = {
  chatId: number;
  chatType: ChatType;
  authorizedMode?: AuthorizedMode;
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
  mediaKind: 'photo' | 'document_image' | 'voice' | 'audio' | 'video_note';
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
  isBot: boolean;
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
};
