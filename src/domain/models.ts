export type ChatType = "private" | "group" | "supergroup" | "channel" | "unknown";

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
  fromDisplayName: string;
  isBot: boolean;
  entities: Array<{ type: string; offset: number; length: number }>;
  replyToUserId: number | null;
};

export type StoredMessage = {
  chatId: number;
  messageId: number;
  userId: number | null;
  senderDisplayName: string;
  text: string;
  createdAt: string;
  isBot: boolean;
};

export type ChatState = {
  chatId: number;
  chatType: ChatType;
  title: string | null;
  lastMessageAt: string | null;
  lastBotMessageAt: string | null;
  summaryText: string | null;
  summaryUpdatedAt: string | null;
  summaryCursorMessageId: number;
  unsummarizedMessageCount: number;
};

export type ParticipantProfile = {
  chatId: number;
  userId: number;
  username: string | null;
  displayName: string;
  profileSummaryText: string | null;
  profileUpdatedAt: string | null;
};

export type ParticipantMemoryStability = "core" | "durable" | "volatile";

export type ParticipantMemorySourceKind = "explicit" | "observed" | "inferred";

export type ParticipantMemoryStatus =
  | "active"
  | "superseded"
  | "expired"
  | "rejected";

export type ParticipantMemoryCardinality = "single" | "multi";

export type ParticipantMemory = {
  memoryId: number;
  chatId: number;
  userId: number;
  category: string;
  key: string;
  valueText: string;
  valueNormalized: string;
  stability: ParticipantMemoryStability;
  sourceKind: ParticipantMemorySourceKind;
  confidence: number;
  cardinality: ParticipantMemoryCardinality;
  status: ParticipantMemoryStatus;
  isPinned: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  lastConfirmedAt: string | null;
  expiresAt: string | null;
  supersedesMemoryId: number | null;
};

export type ParticipantMemoryUpdate = {
  userId: number;
  category: string;
  key: string;
  valueText: string;
  stability: ParticipantMemoryStability;
  sourceKind: ParticipantMemorySourceKind;
  confidence: number;
  cardinality: ParticipantMemoryCardinality;
};

export type BotSelfMemoryUpdate = {
  category: string;
  key: string;
  valueText: string;
  stability: ParticipantMemoryStability;
  sourceKind: ParticipantMemorySourceKind;
  confidence: number;
  cardinality: ParticipantMemoryCardinality;
};

export type SummaryResult = {
  chatSummary: string;
  memoryUpdates: ParticipantMemoryUpdate[];
  selfMemoryUpdates: BotSelfMemoryUpdate[];
};
