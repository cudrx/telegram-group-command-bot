export type ChatType = "private" | "group" | "supergroup" | "channel" | "unknown";

export type AssistantIntent = "explain" | "summarize" | "decide";

export type DirectTrigger =
  | {
      kind: "command";
      intent: AssistantIntent;
      commandText: string;
    }
  | { kind: "none" };

export type ReplyReason = "command";

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
  replyToMessageSnapshot: StoredMessage | null;
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
