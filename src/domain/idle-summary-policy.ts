export type IdleSummaryPolicyInput = {
  lastMessageAt: string | null;
  lastSummaryAt: string | null;
  unsummarizedMessageCount: number;
  idleThresholdMs: number;
  minMessages: number;
  now: string;
};

export function shouldRunIdleSummary(input: IdleSummaryPolicyInput): boolean {
  if (input.lastMessageAt === null) {
    return false;
  }

  if (input.unsummarizedMessageCount < input.minMessages) {
    return false;
  }

  const now = Date.parse(input.now);
  const lastMessageAt = Date.parse(input.lastMessageAt);

  if (Number.isNaN(now) || Number.isNaN(lastMessageAt)) {
    return false;
  }

  if (now - lastMessageAt < input.idleThresholdMs) {
    return false;
  }

  if (input.lastSummaryAt === null) {
    return true;
  }

  const lastSummaryAt = Date.parse(input.lastSummaryAt);

  if (Number.isNaN(lastSummaryAt)) {
    return false;
  }

  return lastSummaryAt < lastMessageAt;
}
