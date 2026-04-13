import type {
  ReplyContext,
  ResolvedParticipantContext,
  StoredMessage
} from "../../src/domain/models.js";

export type LlmReplyEvalScenario = {
  id: string;
  title: string;
  description: string;
  chatSummary: string | null;
  participantMemoryContext: string | null;
  socialIntent: boolean;
  socialIntentReason: string | null;
  resolvedParticipants: Array<{
    userId: number;
    displayName: string;
  }>;
  socialParticipantContexts: ResolvedParticipantContext[];
  targetDisplayName: string;
  reason: string;
  replyContext: ReplyContext;
  humanReview: {
    must: string[];
    mustNot: string[];
    notes: string;
  };
};

const chatId = 6301;

export function message(
  messageId: number,
  userId: number,
  senderDisplayName: string,
  text: string
): StoredMessage {
  return {
    chatId,
    messageId,
    userId,
    senderDisplayName,
    text,
    createdAt: `2026-04-13T12:${String(messageId % 60).padStart(2, "0")}:00.000Z`,
    isBot: false,
    replyToMessageId: null
  };
}

export function botMessage(messageId: number, text: string): StoredMessage {
  return {
    chatId,
    messageId,
    userId: 777000,
    senderDisplayName: "Хрюпа",
    text,
    createdAt: `2026-04-13T12:${String(messageId % 60).padStart(2, "0")}:30.000Z`,
    isBot: true,
    replyToMessageId: messageId - 1
  };
}
