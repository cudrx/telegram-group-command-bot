type TypingIndicatorOptions = {
  chatId: number;
  minTypingMs: number;
  maxTypingMs: number;
  refreshMs: number;
  random: () => number;
  delay: (ms: number) => Promise<void>;
  sendTyping: (chatId: number) => Promise<void>;
};

export async function withTypingIndicator<T>(
  options: TypingIndicatorOptions,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  const visibleTypingMs = pickVisibleTypingMs(
    options.minTypingMs,
    options.maxTypingMs,
    options.random
  );

  void safeSendTyping(options.sendTyping, options.chatId);

  const interval =
    options.refreshMs > 0
      ? setInterval(() => {
          void safeSendTyping(options.sendTyping, options.chatId);
        }, options.refreshMs)
      : null;

  interval?.unref?.();

  let result!: T;

  try {
    result = await operation();
  } finally {
    if (interval) {
      clearInterval(interval);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const remainingMs = Math.max(visibleTypingMs - elapsedMs, 0);

  if (remainingMs > 0) {
    await options.delay(remainingMs);
  }

  return result;
}

function pickVisibleTypingMs(
  minMs: number,
  maxMs: number,
  random: () => number
): number {
  if (maxMs <= minMs) {
    return minMs;
  }

  return Math.round(minMs + random() * (maxMs - minMs));
}

async function safeSendTyping(
  sendTyping: (chatId: number) => Promise<void>,
  chatId: number
): Promise<void> {
  try {
    await sendTyping(chatId);
  } catch {
    // Typing is best-effort and must never block the reply.
  }
}
