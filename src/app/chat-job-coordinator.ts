import type { ChatType } from "../domain/models.js";

export type ReplyReason = "mention" | "reply_to_bot" | "direct_message" | "interjection";
export type ChatJobPhase = "replying" | "summarizing";

export type PendingReplyRequest = {
  chatId: number;
  chatType: ChatType;
  chatTitle: string | null;
  triggerMessageId: number;
  triggerReplyToMessageId: number | null;
  fromUserId: number | null;
  fromDisplayName: string;
  createdAt: string;
  reason: ReplyReason;
};

export type PendingChatWork =
  | { type: "reply"; request: PendingReplyRequest }
  | { type: "summary" };

type ChatJobState = {
  phase: ChatJobPhase | null;
  pendingReply: PendingReplyRequest | null;
  pendingSummary: boolean;
};

export class ChatJobCoordinator {
  private readonly states = new Map<number, ChatJobState>();

  start(chatId: number, phase: ChatJobPhase): boolean {
    const state = this.getOrCreateState(chatId);

    if (state.phase !== null) {
      return false;
    }

    state.phase = phase;

    return true;
  }

  finish(chatId: number, phase: ChatJobPhase): void {
    const state = this.states.get(chatId);

    if (!state || state.phase !== phase) {
      return;
    }

    state.phase = null;
    this.cleanup(chatId, state);
  }

  queueReply(request: PendingReplyRequest): void {
    const state = this.getOrCreateState(request.chatId);

    state.pendingReply = pickPreferredReply(state.pendingReply, request);
  }

  queueSummary(chatId: number): void {
    const state = this.getOrCreateState(chatId);

    state.pendingSummary = true;
  }

  takeNext(chatId: number): PendingChatWork | null {
    const state = this.states.get(chatId);

    if (!state || state.phase !== null) {
      return null;
    }

    if (state.pendingReply) {
      const request = state.pendingReply;

      state.pendingReply = null;
      this.cleanup(chatId, state);

      return {
        type: "reply",
        request
      };
    }

    if (state.pendingSummary) {
      state.pendingSummary = false;
      this.cleanup(chatId, state);

      return {
        type: "summary"
      };
    }

    return null;
  }

  getPhase(chatId: number): ChatJobPhase | null {
    return this.states.get(chatId)?.phase ?? null;
  }

  private getOrCreateState(chatId: number): ChatJobState {
    const existing = this.states.get(chatId);

    if (existing) {
      return existing;
    }

    const created: ChatJobState = {
      phase: null,
      pendingReply: null,
      pendingSummary: false
    };

    this.states.set(chatId, created);

    return created;
  }

  private cleanup(chatId: number, state: ChatJobState): void {
    if (state.phase !== null || state.pendingReply !== null || state.pendingSummary) {
      return;
    }

    this.states.delete(chatId);
  }
}

function pickPreferredReply(
  current: PendingReplyRequest | null,
  next: PendingReplyRequest
): PendingReplyRequest {
  if (!current) {
    return next;
  }

  const currentPriority = getReplyPriority(current.reason);
  const nextPriority = getReplyPriority(next.reason);

  if (nextPriority > currentPriority) {
    return next;
  }

  if (nextPriority < currentPriority) {
    return current;
  }

  return next.triggerMessageId >= current.triggerMessageId ? next : current;
}

function getReplyPriority(reason: ReplyReason): number {
  switch (reason) {
    case "mention":
      return 3;
    case "reply_to_bot":
    case "direct_message":
      return 2;
    case "interjection":
      return 1;
  }
}
