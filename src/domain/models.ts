export type ChatType = "private" | "group" | "supergroup" | "channel" | "unknown";

export type ReplyReason = "mention" | "reply_to_bot";

export type NormalizedMessage = {
  chatId: number;
  chatType: ChatType;
  chatTitle: string | null;
  messageId: number;
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
};

export type StoredMessage = {
  chatId: number;
  messageId: number;
  userId: number | null;
  senderDisplayName: string;
  text: string;
  createdAt: string;
  isBot: boolean;
  replyToMessageId: number | null;
};

export type ReplyContext = {
  triggerMessage: StoredMessage | null;
  anchorBotMessage: StoredMessage | null;
  anchorParentMessage: StoredMessage | null;
  priorContextMessages: StoredMessage[];
};

export type ChatState = {
  chatId: number;
  chatType: ChatType;
  title: string | null;
  lastMessageAt: string | null;
  lastBotMessageAt: string | null;
};
