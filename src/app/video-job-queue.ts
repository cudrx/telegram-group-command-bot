import type { AppLogger } from '../logging/logger.js';

export type VideoJobSource = 'instagram' | 'reddit' | 'youtube' | 'other';
export type VideoJob<T> = {
  chatId: number;
  source: VideoJobSource;
  triggerMessageId: number;
  onQueued?: (() => void | Promise<void>) | undefined;
  beforeRun?: (() => void | Promise<void>) | undefined;
  run: () => Promise<T>;
};

type QueuedJob<T> = {
  chatId: VideoJob<T>['chatId'];
  source: VideoJob<T>['source'];
  triggerMessageId: VideoJob<T>['triggerMessageId'];
  enqueuedAtMs: number;
  waitDurationMs: number | null;
  onQueued?: VideoJob<T>['onQueued'];
  beforeRun?: VideoJob<T>['beforeRun'];
  run: VideoJob<T>['run'];
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  queuedNotified: boolean;
};

export type VideoJobQueue = {
  enqueue<T>(job: VideoJob<T>): Promise<T>;
};

export function createVideoJobQueue(input: {
  maxConcurrentJobs: number;
  maxConcurrentJobsPerChat: number;
  logger?: Pick<AppLogger, 'debug' | 'warn'> | undefined;
  nowMs?: (() => number) | undefined;
}) {
  const queuedJobs: QueuedJob<unknown>[] = [];
  const runningChats = new Map<number, number>();
  let runningJobs = 0;
  const nowMs = input.nowMs ?? Date.now;

  async function enqueue<T>(job: {
    chatId: number;
    source: VideoJobSource;
    triggerMessageId: number;
    onQueued?: (() => void | Promise<void>) | undefined;
    beforeRun?: (() => void | Promise<void>) | undefined;
    run: () => Promise<T>;
  }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queuedJob: QueuedJob<T> = {
        ...job,
        enqueuedAtMs: nowMs(),
        waitDurationMs: null,
        resolve,
        reject,
        queuedNotified: false
      };

      if (canStartImmediately(queuedJob)) {
        startJob(queuedJob);
        return;
      }

      queuedJobs.push(queuedJob as QueuedJob<unknown>);
      input.logger?.debug('video_job_enqueued', {
        chatId: queuedJob.chatId,
        source: queuedJob.source,
        triggerMessageId: queuedJob.triggerMessageId,
        queueLength: queuedJobs.length
      });
      queuedJob.queuedNotified = true;
      void notifyQueued(queuedJob);
      void pumpQueue();
    });
  }

  async function pumpQueue(): Promise<void> {
    while (runningJobs < input.maxConcurrentJobs) {
      const nextIndex = findNextEligibleIndex();
      if (nextIndex < 0) return;

      const nextJob = queuedJobs.splice(nextIndex, 1)[0];
      if (!nextJob) return;

      startJob(nextJob);
    }
  }

  function canStartImmediately<T>(job: QueuedJob<T>): boolean {
    return (
      queuedJobs.length === 0 &&
      runningJobs < input.maxConcurrentJobs &&
      (runningChats.get(job.chatId) ?? 0) < input.maxConcurrentJobsPerChat
    );
  }

  function startJob<T>(job: QueuedJob<T>): void {
    runningJobs += 1;
    runningChats.set(job.chatId, (runningChats.get(job.chatId) ?? 0) + 1);
    job.waitDurationMs = nowMs() - job.enqueuedAtMs;
    input.logger?.debug('video_job_started', {
      chatId: job.chatId,
      source: job.source,
      triggerMessageId: job.triggerMessageId,
      waitDurationMs: job.waitDurationMs
    });

    void runJob(job);
  }

  async function notifyQueued<T>(job: QueuedJob<T>): Promise<void> {
    try {
      await job.onQueued?.();
    } catch {
      // Queue notification is best-effort and should not cancel the job.
    }
  }

  async function runJob<T>(job: QueuedJob<T>): Promise<void> {
    try {
      await job.beforeRun?.();
      job.resolve(await job.run());
      input.logger?.debug('video_job_completed', {
        chatId: job.chatId,
        source: job.source,
        triggerMessageId: job.triggerMessageId,
        waitDurationMs: job.waitDurationMs ?? nowMs() - job.enqueuedAtMs
      });
    } catch (error) {
      input.logger?.warn(getFailureEvent(error), {
        chatId: job.chatId,
        source: job.source,
        triggerMessageId: job.triggerMessageId,
        waitDurationMs: job.waitDurationMs ?? nowMs() - job.enqueuedAtMs,
        ...toErrorLogFields(error)
      });
      job.reject(error);
    } finally {
      runningJobs -= 1;
      const currentChatCount = runningChats.get(job.chatId) ?? 0;

      if (currentChatCount <= 1) {
        runningChats.delete(job.chatId);
      } else {
        runningChats.set(job.chatId, currentChatCount - 1);
      }

      void pumpQueue();
    }
  }

  function findNextEligibleIndex(): number {
    for (let index = 0; index < queuedJobs.length; index += 1) {
      const job = queuedJobs[index];
      if (!job) continue;

      if (
        (runningChats.get(job.chatId) ?? 0) >= input.maxConcurrentJobsPerChat
      ) {
        continue;
      }

      return index;
    }

    return -1;
  }

  return { enqueue } satisfies VideoJobQueue;
}

function getFailureEvent(error: unknown): string {
  if (error instanceof Error && error.name === 'InstagramSourceLockedError') {
    return 'video_job_rejected_source_locked';
  }

  return 'video_job_failed';
}

function toErrorLogFields(error: unknown): {
  errorName: string | null;
  errorMessage: string;
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message
    };
  }

  return {
    errorName: null,
    errorMessage: String(error)
  };
}
