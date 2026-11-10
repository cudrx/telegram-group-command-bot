import { z } from 'zod';

import type { SpontaneousPolicy } from '../../config/runtime/spontaneous.js';
import type { DatabaseClient } from '../../database/index.js';
import type { StoredMessage } from '../../domain/models.js';

const stateSchema = z
  .object({
    lastAttemptAt: z.number().finite(),
    lastMessageId: z.number().int(),
    attempts: z.array(z.number().finite())
  })
  .strict();

// Prepare and reserve in the same synchronous turn, before awaiting the LLM.
export function prepareSpontaneousAttempt(input: {
  db: Pick<DatabaseClient, 'getAppState' | 'setAppState'>;
  chatId: number;
  triggerMessageId: number;
  now: string;
  messages: StoredMessage[];
  policy: SpontaneousPolicy;
  random: () => number;
}): { reserve(): void } | null {
  const key = `spontaneous:${input.chatId}`;
  const raw = input.db.getAppState(key);
  const state = raw ? stateSchema.parse(JSON.parse(raw)) : null;
  const nowMs = Date.parse(input.now);
  const attempts = state?.attempts.filter((at) => nowMs - at < 3600000) ?? [];
  const newMessages = input.messages.filter(
    (message) =>
      !message.isBot &&
      message.text.trim() &&
      !message.text.trimStart().startsWith('/') &&
      message.messageId > (state?.lastMessageId ?? 0)
  ).length;
  if (
    (state &&
      nowMs - state.lastAttemptAt < input.policy.cooldownSeconds * 1000) ||
    attempts.length >= input.policy.maxAttemptsPerHour ||
    newMessages < input.policy.minMessages ||
    input.random() >= input.policy.probability
  )
    return null;

  return {
    reserve() {
      input.db.setAppState(
        key,
        JSON.stringify({
          lastAttemptAt: nowMs,
          lastMessageId: input.triggerMessageId,
          attempts: [...attempts, nowMs]
        }),
        input.now
      );
    }
  };
}
