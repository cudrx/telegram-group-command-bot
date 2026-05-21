import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  withChatActionIndicator,
  withTypingIndicator
} from '../src/app/typing-indicator.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

describe('withTypingIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('calls sendTyping immediately and returns the operation result', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const operation = vi.fn().mockResolvedValue('reply');

    const resultPromise = withTypingIndicator(
      {
        chatId: 42,
        minTypingMs: 0,
        maxTypingMs: 0,
        refreshMs: 1000,
        random: () => 0,
        delay: async () => undefined,
        sendTyping
      },
      operation
    );

    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(sendTyping).toHaveBeenCalledWith(42);

    await expect(resultPromise).resolves.toBe('reply');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  test('refreshes typing while the operation remains pending', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const deferred = createDeferred<string>();

    const resultPromise = withTypingIndicator(
      {
        chatId: 7,
        minTypingMs: 0,
        maxTypingMs: 0,
        refreshMs: 4000,
        random: () => 0,
        delay: async () => undefined,
        sendTyping
      },
      () => deferred.promise
    );

    expect(sendTyping).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3999);
    expect(sendTyping).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(sendTyping).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4000);
    expect(sendTyping).toHaveBeenCalledTimes(3);

    deferred.resolve('done');
    await expect(resultPromise).resolves.toBe('done');
  });

  test('waits only for the remaining visible typing duration', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const deferred = createDeferred<string>();
    let settled = false;

    const resultPromise = withTypingIndicator(
      {
        chatId: 9,
        minTypingMs: 1000,
        maxTypingMs: 2000,
        refreshMs: 5000,
        random: () => 0.5,
        delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        sendTyping
      },
      () => deferred.promise
    );

    void resultPromise.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(500);
    deferred.resolve('visible');

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toBe('visible');
  });

  test('stops refreshing once the operation resolves even while waiting to stay visible', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const deferred = createDeferred<string>();

    const resultPromise = withTypingIndicator(
      {
        chatId: 21,
        minTypingMs: 1000,
        maxTypingMs: 1000,
        refreshMs: 300,
        random: () => 0,
        delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        sendTyping
      },
      () => deferred.promise
    );

    await vi.advanceTimersByTimeAsync(200);
    deferred.resolve('done');

    await vi.advanceTimersByTimeAsync(799);
    expect(sendTyping).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toBe('done');
  });

  test('clears the interval and rethrows operation errors', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const deferred = createDeferred<never>();
    const error = new Error('boom');

    const resultPromise = withTypingIndicator(
      {
        chatId: 13,
        minTypingMs: 0,
        maxTypingMs: 0,
        refreshMs: 50,
        random: () => 0,
        delay: async () => undefined,
        sendTyping
      },
      () => deferred.promise
    );

    await vi.advanceTimersByTimeAsync(50);
    expect(sendTyping).toHaveBeenCalledTimes(2);

    deferred.reject(error);

    await expect(resultPromise).rejects.toThrow(error);

    await vi.advanceTimersByTimeAsync(500);
    expect(sendTyping).toHaveBeenCalledTimes(2);
  });
});

describe('withChatActionIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('sends the configured chat action immediately', async () => {
    const sendChatAction = vi.fn().mockResolvedValue(undefined);

    await withChatActionIndicator(
      {
        chatId: 42,
        action: 'record_voice',
        minVisibleMs: 0,
        maxVisibleMs: 0,
        refreshMs: 4000,
        random: () => 0,
        delay: vi.fn().mockResolvedValue(undefined),
        sendChatAction
      },
      async () => 'ok'
    );

    expect(sendChatAction).toHaveBeenCalledWith(42, 'record_voice');
  });

  test('supports Telegram upload actions', async () => {
    const sendChatAction = vi.fn().mockResolvedValue(undefined);

    await withChatActionIndicator(
      {
        chatId: 42,
        action: 'upload_video',
        minVisibleMs: 0,
        maxVisibleMs: 0,
        refreshMs: 4000,
        random: () => 0,
        delay: vi.fn().mockResolvedValue(undefined),
        sendChatAction
      },
      async () => 'ok'
    );

    expect(sendChatAction).toHaveBeenCalledWith(42, 'upload_video');
  });
});
