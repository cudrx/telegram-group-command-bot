export type TelegramChatAction =
  | 'typing'
  | 'record_voice'
  | 'upload_photo'
  | 'upload_video';

type TypingIndicatorOptions = {
  chatId: number;
  minTypingMs: number;
  maxTypingMs: number;
  refreshMs: number;
  random: () => number;
  delay: (ms: number) => Promise<void>;
  sendTyping: (chatId: number) => Promise<void>;
};

type ChatActionIndicatorOptions = {
  chatId: number;
  action: TelegramChatAction;
  minVisibleMs: number;
  maxVisibleMs: number;
  refreshMs: number;
  random: () => number;
  delay: (ms: number) => Promise<void>;
  sendChatAction: (chatId: number, action: TelegramChatAction) => Promise<void>;
};

export function withTypingIndicator<T>(
  options: TypingIndicatorOptions,
  operation: () => Promise<T>
): Promise<T> {
  return withChatActionIndicator(
    {
      chatId: options.chatId,
      action: 'typing',
      minVisibleMs: options.minTypingMs,
      maxVisibleMs: options.maxTypingMs,
      refreshMs: options.refreshMs,
      random: options.random,
      delay: options.delay,
      sendChatAction: (chatId) => options.sendTyping(chatId)
    },
    operation
  );
}

export async function withChatActionIndicator<T>(
  options: ChatActionIndicatorOptions,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  const visibleMs = pickVisibleMs(
    options.minVisibleMs,
    options.maxVisibleMs,
    options.random
  );

  void safeSendChatAction(
    options.sendChatAction,
    options.chatId,
    options.action
  );

  const interval =
    options.refreshMs > 0
      ? setInterval(() => {
          void safeSendChatAction(
            options.sendChatAction,
            options.chatId,
            options.action
          );
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
  const remainingMs = Math.max(visibleMs - elapsedMs, 0);

  if (remainingMs > 0) {
    await options.delay(remainingMs);
  }

  return result;
}

function pickVisibleMs(
  minMs: number,
  maxMs: number,
  random: () => number
): number {
  if (maxMs <= minMs) {
    return minMs;
  }

  return Math.round(minMs + random() * (maxMs - minMs));
}

async function safeSendChatAction(
  sendChatAction: (chatId: number, action: TelegramChatAction) => Promise<void>,
  chatId: number,
  action: TelegramChatAction
): Promise<void> {
  try {
    await sendChatAction(chatId, action);
  } catch {
    // Chat actions are best-effort and must never block the reply.
  }
}
