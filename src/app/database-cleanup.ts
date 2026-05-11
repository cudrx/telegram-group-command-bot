import type { AppEnv } from '../config/env/index.js';
import type { DatabaseClient } from '../database/index.js';
import type { AppLogger } from '../logging/logger.js';

export type CleanupScheduler = {
  start(): void;
  stop(): void;
};

export function createCleanupScheduler(input: {
  db: DatabaseClient;
  env: AppEnv;
  logger: AppLogger;
  now: () => string;
}): CleanupScheduler {
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  const runCleanup = () => {
    const deleted = input.db.cleanupExpiredData({
      now: input.now(),
      messageRetentionDays: input.env.messageRetentionDays,
      mediaArtifactRetentionDays: input.env.mediaArtifactRetentionDays,
      memeHistoryRetentionDays: input.env.memeHistoryRetentionDays
    });

    input.logger.debug('database_cleanup_completed', deleted);
  };

  return {
    start() {
      runCleanup();
      cleanupTimer = setInterval(
        runCleanup,
        input.env.databaseCleanupIntervalHours * 60 * 60 * 1000
      );
      cleanupTimer.unref?.();
    },

    stop() {
      if (!cleanupTimer) {
        return;
      }

      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  };
}
