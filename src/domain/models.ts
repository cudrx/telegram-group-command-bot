export type ChatType = "private" | "group" | "supergroup" | "channel" | "unknown";

export type ReplyReason = "mention" | "reply_to_bot" | "direct_message" | "interjection";

export type InterventionGoal =
  | "engage"
  | "deescalate"
  | "provoke"
  | "joke"
  | "support";

export type InterventionDecision = {
  shouldIntervene: boolean;
  situationKind: string | null;
  goal: InterventionGoal | null;
  intensity: "low" | "medium" | "high" | null;
  reason: string | null;
  confidence: number;
};

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
  lastName?: string | null;
  profileSummaryText: string | null;
  profileUpdatedAt: string | null;
};

export type ParticipantAliasKind =
  | "username"
  | "first_name"
  | "full_name"
  | "canonical_label";

export type ParticipantAliasRecord = {
  chatId: number;
  userId: number;
  aliasText: string;
  aliasNormalized: string;
  aliasKind: ParticipantAliasKind;
  confidence: number;
  lastSeenAt: string;
  displayName: string;
};

export type ResolvedParticipant = {
  userId: number;
  displayName: string;
};

export type AmbiguousParticipantCandidate = {
  candidate: string;
  matches: ResolvedParticipant[];
};

export type ParticipantReferenceResolution = {
  resolvedParticipants: ResolvedParticipant[];
  ambiguousParticipants: AmbiguousParticipantCandidate[];
  unresolvedCandidates: string[];
};

export type SocialIntentReason =
  | "relationship_question"
  | "support_question"
  | "participant_status_question"
  | "participant_description_request";

export type SocialIntentResult = {
  isSocialQa: boolean;
  reason: SocialIntentReason | null;
};

export type ResolvedParticipantContext = {
  userId: number;
  displayName: string;
  participantMemoryContext: string | null;
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

export type SummaryResult = {
  chatSummary: string;
  memoryUpdates: ParticipantMemoryUpdate[];
};
