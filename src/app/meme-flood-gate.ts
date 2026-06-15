export type MemeFloodGate = {
  getRetryAfterSeconds(chatId: number): number | null;
  block(chatId: number, retryAfterSeconds: number): void;
};

export function createMemeFloodGate(
  input: { nowMs?: (() => number) | undefined } = {}
): MemeFloodGate {
  const blockedUntilByChat = new Map<number, number>();
  const nowMs = input.nowMs ?? Date.now;

  return {
    getRetryAfterSeconds(chatId) {
      const blockedUntilMs = blockedUntilByChat.get(chatId);
      if (blockedUntilMs === undefined) {
        return null;
      }

      const currentNowMs = nowMs();
      if (blockedUntilMs <= currentNowMs) {
        blockedUntilByChat.delete(chatId);
        return null;
      }

      return Math.max(1, Math.ceil((blockedUntilMs - currentNowMs) / 1_000));
    },
    block(chatId, retryAfterSeconds) {
      blockedUntilByChat.set(chatId, nowMs() + retryAfterSeconds * 1_000);
    }
  };
}
