import type { StoredMessage } from '../../domain/models.js';

export type WeeklyMessage = StoredMessage & {
  mediaSummary: string | null;
};

export type WeeklyEventKind =
  | 'burst'
  | 'reply_hotspot'
  | 'reply_chain'
  | 'media_moment';

export type WeeklyEventCandidate = {
  id: string;
  kinds: WeeklyEventKind[];
  startAt: string;
  endAt: string;
  messageIds: number[];
  participantIds: number[];
  score: number;
  reasons: string[];
};

export type WeeklyStats = {
  totalHumanMessages: number;
  participants: number;
  replyMessages: number;
  mediaMessages: number;
  mediaMessagesWithSuccessfulSummaries: number;
  topActiveDays: Array<[string, number]>;
};

export type WeeklyDatasetPeriod = {
  fromInclusive: string;
  toExclusive: string;
};

export type WeeklyParticipantStats = {
  userId: number | null;
  displayName: string;
  messageCount: number;
};

export type WeeklyDatasetEvent = WeeklyEventCandidate & {
  messages: WeeklyMessage[];
  excerptMessages: WeeklyMessage[];
  omittedMessageCount: number;
};

export type WeeklyDataset = {
  period: WeeklyDatasetPeriod;
  stats: WeeklyStats;
  participantStats: WeeklyParticipantStats[];
  selectedEvents: WeeklyDatasetEvent[];
};
