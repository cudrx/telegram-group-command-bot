import { describe, expect, test, vi } from 'vitest';

import { createVideoJobQueue } from '../../src/app/video-job-queue.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

describe('createVideoJobQueue', () => {
  test('starts immediately when slots are available', async () => {
    const queue = createVideoJobQueue({
      maxConcurrentJobs: 2,
      maxConcurrentJobsPerChat: 1
    });
    const run = vi.fn().mockResolvedValue('done');
    const onQueued = vi.fn();

    await expect(
      queue.enqueue({
        chatId: 1,
        source: 'youtube',
        triggerMessageId: 10,
        onQueued,
        run
      })
    ).resolves.toBe('done');

    expect(run).toHaveBeenCalledTimes(1);
    expect(onQueued).not.toHaveBeenCalled();
  });

  test('queues a second job from the same chat', async () => {
    const queue = createVideoJobQueue({
      maxConcurrentJobs: 2,
      maxConcurrentJobsPerChat: 1
    });
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const firstRun = vi.fn().mockReturnValue(first.promise);
    const secondRun = vi.fn().mockReturnValue(second.promise);
    const secondQueued = vi.fn();

    const firstPromise = queue.enqueue({
      chatId: 1,
      source: 'youtube',
      triggerMessageId: 10,
      onQueued: vi.fn(),
      run: firstRun
    });
    const secondPromise = queue.enqueue({
      chatId: 1,
      source: 'instagram',
      triggerMessageId: 11,
      onQueued: secondQueued,
      run: secondRun
    });

    await Promise.resolve();
    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(secondRun).not.toHaveBeenCalled();
    expect(secondQueued).toHaveBeenCalledTimes(1);

    first.resolve('first');
    await expect(firstPromise).resolves.toBe('first');
    await Promise.resolve();

    expect(secondRun).toHaveBeenCalledTimes(1);
    second.resolve('second');
    await expect(secondPromise).resolves.toBe('second');
  });

  test('runs up to the global limit across different chats', async () => {
    const queue = createVideoJobQueue({
      maxConcurrentJobs: 2,
      maxConcurrentJobsPerChat: 1
    });
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const third = createDeferred<string>();
    const firstRun = vi.fn().mockReturnValue(first.promise);
    const secondRun = vi.fn().mockReturnValue(second.promise);
    const thirdRun = vi.fn().mockReturnValue(third.promise);
    const thirdQueued = vi.fn();

    const firstPromise = queue.enqueue({
      chatId: 1,
      source: 'youtube',
      triggerMessageId: 10,
      onQueued: vi.fn(),
      run: firstRun
    });
    const secondPromise = queue.enqueue({
      chatId: 2,
      source: 'reddit',
      triggerMessageId: 20,
      onQueued: vi.fn(),
      run: secondRun
    });
    const thirdPromise = queue.enqueue({
      chatId: 3,
      source: 'instagram',
      triggerMessageId: 30,
      onQueued: thirdQueued,
      run: thirdRun
    });

    await Promise.resolve();
    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(secondRun).toHaveBeenCalledTimes(1);
    expect(thirdRun).not.toHaveBeenCalled();
    expect(thirdQueued).toHaveBeenCalledTimes(1);

    first.resolve('first');
    await expect(firstPromise).resolves.toBe('first');
    await Promise.resolve();

    expect(thirdRun).toHaveBeenCalledTimes(1);
    second.resolve('second');
    third.resolve('third');
    await expect(secondPromise).resolves.toBe('second');
    await expect(thirdPromise).resolves.toBe('third');
  });

  test('skips an ineligible queued job and starts the first eligible one', async () => {
    const queue = createVideoJobQueue({
      maxConcurrentJobs: 2,
      maxConcurrentJobsPerChat: 1
    });
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const third = createDeferred<string>();
    const firstRun = vi.fn().mockReturnValue(first.promise);
    const secondRun = vi.fn().mockReturnValue(second.promise);
    const thirdRun = vi.fn().mockReturnValue(third.promise);

    const firstPromise = queue.enqueue({
      chatId: 1,
      source: 'youtube',
      triggerMessageId: 10,
      onQueued: vi.fn(),
      run: firstRun
    });
    const secondPromise = queue.enqueue({
      chatId: 1,
      source: 'instagram',
      triggerMessageId: 11,
      onQueued: vi.fn(),
      run: secondRun
    });
    const thirdPromise = queue.enqueue({
      chatId: 2,
      source: 'reddit',
      triggerMessageId: 12,
      onQueued: vi.fn(),
      run: thirdRun
    });

    await Promise.resolve();
    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(secondRun).not.toHaveBeenCalled();
    expect(thirdRun).toHaveBeenCalledTimes(1);

    third.resolve('third');
    await expect(thirdPromise).resolves.toBe('third');
    await Promise.resolve();

    first.resolve('first');
    await expect(firstPromise).resolves.toBe('first');
    await Promise.resolve();

    expect(secondRun).toHaveBeenCalledTimes(1);
    second.resolve('second');
    await expect(secondPromise).resolves.toBe('second');
  });

  test('releases slots after failure', async () => {
    const queue = createVideoJobQueue({
      maxConcurrentJobs: 1,
      maxConcurrentJobsPerChat: 1
    });
    const secondRun = vi.fn().mockResolvedValue('second');

    await expect(
      queue.enqueue({
        chatId: 1,
        source: 'youtube',
        triggerMessageId: 10,
        onQueued: vi.fn(),
        run: vi.fn().mockRejectedValue(new Error('boom'))
      })
    ).rejects.toThrow('boom');

    await expect(
      queue.enqueue({
        chatId: 1,
        source: 'youtube',
        triggerMessageId: 11,
        onQueued: vi.fn(),
        run: secondRun
      })
    ).resolves.toBe('second');

    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  test('logs queue lifecycle and source-lock rejections', async () => {
    const logger = {
      debug: vi.fn(),
      warn: vi.fn()
    };
    let nowMs = 1000;
    const queue = createVideoJobQueue({
      maxConcurrentJobs: 1,
      maxConcurrentJobsPerChat: 1,
      logger,
      nowMs: () => nowMs
    });
    const first = createDeferred<string>();
    const lockedError = new Error('Instagram source is locked');
    lockedError.name = 'InstagramSourceLockedError';

    const firstPromise = queue.enqueue({
      chatId: 1,
      source: 'youtube',
      triggerMessageId: 10,
      run: vi.fn().mockReturnValue(first.promise)
    });
    const secondPromise = queue.enqueue({
      chatId: 2,
      source: 'instagram',
      triggerMessageId: 20,
      beforeRun: vi.fn().mockRejectedValue(lockedError),
      run: vi.fn().mockResolvedValue('second')
    });

    await Promise.resolve();
    expect(logger.debug).toHaveBeenCalledWith('video_job_started', {
      chatId: 1,
      source: 'youtube',
      triggerMessageId: 10,
      waitDurationMs: 0
    });
    expect(logger.debug).toHaveBeenCalledWith('video_job_enqueued', {
      chatId: 2,
      source: 'instagram',
      triggerMessageId: 20,
      queueLength: 1
    });

    nowMs = 1250;
    first.resolve('first');
    await expect(firstPromise).resolves.toBe('first');
    await expect(secondPromise).rejects.toThrow('Instagram source is locked');

    expect(logger.debug).toHaveBeenCalledWith('video_job_completed', {
      chatId: 1,
      source: 'youtube',
      triggerMessageId: 10,
      waitDurationMs: 0
    });
    expect(logger.debug).toHaveBeenCalledWith('video_job_started', {
      chatId: 2,
      source: 'instagram',
      triggerMessageId: 20,
      waitDurationMs: 250
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'video_job_rejected_source_locked',
      {
        chatId: 2,
        source: 'instagram',
        triggerMessageId: 20,
        waitDurationMs: 250,
        errorName: 'InstagramSourceLockedError',
        errorMessage: 'Instagram source is locked'
      }
    );
  });
});
