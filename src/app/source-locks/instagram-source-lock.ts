import { stat as statDefault } from 'node:fs/promises';

import type {
  SourceStateKey,
  StoredSourceState
} from '../../database/index.js';
import type { AppLogger } from '../../logging/logger.js';

const INSTAGRAM_SOURCE_KEY: SourceStateKey = 'instagram';
const LOCK_PATTERNS = [
  'login required',
  'rate-limit reached',
  'instagram api is not granting access',
  'main webpage is locked behind the login page'
] as const;

type SourceStateStore = {
  getSourceState(sourceKey: SourceStateKey): StoredSourceState | null;
  saveSourceState(input: StoredSourceState): void;
};

export class InstagramSourceLockedError extends Error {
  constructor() {
    super('Instagram source is locked until cookies are updated.');
    this.name = 'InstagramSourceLockedError';
  }
}

export function isInstagramSourceLockError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();

  return LOCK_PATTERNS.some((pattern) => message.includes(pattern));
}

export async function markInstagramSourceBlocked(input: {
  db: SourceStateStore;
  cookiesPath: string | null;
  reason: string;
  now: string;
  stat?: typeof statDefault;
  logger?: Pick<AppLogger, 'info'> | undefined;
}): Promise<void> {
  const stat = input.stat ?? statDefault;
  const cookieFileMtimeMsAtBlock = await readCookieFileMtimeMs(
    input.cookiesPath,
    stat
  );

  input.db.saveSourceState({
    sourceKey: INSTAGRAM_SOURCE_KEY,
    state: 'blocked',
    reason: input.reason,
    blockedAt: input.now,
    cookieFileMtimeMsAtBlock,
    updatedAt: input.now
  });
  input.logger?.info('source_locked', {
    source: INSTAGRAM_SOURCE_KEY,
    reason: input.reason,
    cookieFileMtimeMsAtBlock
  });
}

export async function getInstagramSourceAvailability(input: {
  db: SourceStateStore;
  cookiesPath: string | null;
  now: string;
  stat?: typeof statDefault;
  logger?: Pick<AppLogger, 'info'> | undefined;
}): Promise<
  | { allowed: true; unlockedAfterCookieChange: boolean }
  | { allowed: false; reason: 'source_locked' }
> {
  const sourceState = input.db.getSourceState(INSTAGRAM_SOURCE_KEY);
  if (sourceState?.state !== 'blocked') {
    return { allowed: true, unlockedAfterCookieChange: false };
  }

  const stat = input.stat ?? statDefault;
  const currentMtimeMs = await readCookieFileMtimeMs(input.cookiesPath, stat);
  if (
    currentMtimeMs === null ||
    currentMtimeMs === sourceState.cookieFileMtimeMsAtBlock
  ) {
    return { allowed: false, reason: 'source_locked' };
  }

  input.db.saveSourceState({
    sourceKey: INSTAGRAM_SOURCE_KEY,
    state: 'healthy',
    reason: null,
    blockedAt: null,
    cookieFileMtimeMsAtBlock: null,
    updatedAt: input.now
  });
  input.logger?.info('source_unlocked_after_cookie_change', {
    source: INSTAGRAM_SOURCE_KEY,
    previousCookieFileMtimeMs: sourceState.cookieFileMtimeMsAtBlock,
    currentCookieFileMtimeMs: currentMtimeMs
  });

  return { allowed: true, unlockedAfterCookieChange: true };
}

export async function assertInstagramSourceAvailable(input: {
  db: SourceStateStore;
  cookiesPath: string | null;
  now: string;
  stat?: typeof statDefault;
  logger?: Pick<AppLogger, 'info'> | undefined;
}): Promise<{ unlockedAfterCookieChange: boolean }> {
  const availability = await getInstagramSourceAvailability(input);

  if (!availability.allowed) {
    throw new InstagramSourceLockedError();
  }

  return { unlockedAfterCookieChange: availability.unlockedAfterCookieChange };
}

async function readCookieFileMtimeMs(
  cookiesPath: string | null,
  stat: typeof statDefault
): Promise<number | null> {
  if (!cookiesPath) return null;

  try {
    const result = await stat(cookiesPath);
    return Number.isFinite(result.mtimeMs) ? result.mtimeMs : null;
  } catch {
    return null;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  return String(error);
}
