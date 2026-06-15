import { describe, expect, test, vi } from 'vitest';

import {
  getInstagramSourceAvailability,
  isInstagramSourceLockError,
  markInstagramSourceBlocked
} from '../../../src/app/source-locks/instagram-source-lock.js';
import type { StoredSourceState } from '../../../src/database/index.js';

function createDb(initialState: StoredSourceState | null = null) {
  let sourceState = initialState;

  return {
    getSourceState: vi.fn((_sourceKey: 'instagram') => sourceState),
    saveSourceState: vi.fn((nextState: StoredSourceState) => {
      sourceState = nextState;
    }),
    read: () => sourceState
  };
}

describe('isInstagramSourceLockError', () => {
  test('matches login and rate-limit style yt-dlp failures', () => {
    expect(
      isInstagramSourceLockError(
        new Error(
          [
            'WARNING: [Instagram] Main webpage is locked behind the login page.',
            'ERROR: [Instagram] requested content is not available, rate-limit reached or login required'
          ].join('\n')
        )
      )
    ).toBe(true);
  });

  test('ignores unrelated downloader failures', () => {
    expect(
      isInstagramSourceLockError(
        new Error('yt-dlp did not produce an mp4 file')
      )
    ).toBe(false);
  });
});

describe('markInstagramSourceBlocked', () => {
  test('stores blocked state with cookie file mtime', async () => {
    const db = createDb();
    const stat = vi.fn().mockResolvedValue({ mtimeMs: 1234 });
    const logger = { info: vi.fn() };

    await markInstagramSourceBlocked({
      db,
      cookiesPath: '/tmp/instagram-cookies.txt',
      reason: 'auth_required',
      now: '2026-06-15T12:00:00.000Z',
      stat,
      logger
    });

    expect(db.saveSourceState).toHaveBeenCalledWith({
      sourceKey: 'instagram',
      state: 'blocked',
      reason: 'auth_required',
      blockedAt: '2026-06-15T12:00:00.000Z',
      cookieFileMtimeMsAtBlock: 1234,
      updatedAt: '2026-06-15T12:00:00.000Z'
    });
    expect(logger.info).toHaveBeenCalledWith('source_locked', {
      source: 'instagram',
      reason: 'auth_required',
      cookieFileMtimeMsAtBlock: 1234
    });
  });
});

describe('getInstagramSourceAvailability', () => {
  test('allows healthy source without touching persistence', async () => {
    const db = createDb();

    await expect(
      getInstagramSourceAvailability({
        db,
        cookiesPath: '/tmp/instagram-cookies.txt',
        now: '2026-06-15T12:00:00.000Z',
        stat: vi.fn()
      })
    ).resolves.toEqual({ allowed: true, unlockedAfterCookieChange: false });

    expect(db.saveSourceState).not.toHaveBeenCalled();
  });

  test('rejects blocked source when cookie mtime is unchanged', async () => {
    const db = createDb({
      sourceKey: 'instagram',
      state: 'blocked',
      reason: 'auth_required',
      blockedAt: '2026-06-15T11:00:00.000Z',
      cookieFileMtimeMsAtBlock: 1234,
      updatedAt: '2026-06-15T11:00:00.000Z'
    });

    await expect(
      getInstagramSourceAvailability({
        db,
        cookiesPath: '/tmp/instagram-cookies.txt',
        now: '2026-06-15T12:00:00.000Z',
        stat: vi.fn().mockResolvedValue({ mtimeMs: 1234 })
      })
    ).resolves.toEqual({
      allowed: false,
      reason: 'source_locked'
    });
  });

  test('unlocks blocked source when cookie mtime changes', async () => {
    const db = createDb({
      sourceKey: 'instagram',
      state: 'blocked',
      reason: 'auth_required',
      blockedAt: '2026-06-15T11:00:00.000Z',
      cookieFileMtimeMsAtBlock: 1234,
      updatedAt: '2026-06-15T11:00:00.000Z'
    });
    const logger = { info: vi.fn() };

    await expect(
      getInstagramSourceAvailability({
        db,
        cookiesPath: '/tmp/instagram-cookies.txt',
        now: '2026-06-15T12:00:00.000Z',
        stat: vi.fn().mockResolvedValue({ mtimeMs: 5678 }),
        logger
      })
    ).resolves.toEqual({
      allowed: true,
      unlockedAfterCookieChange: true
    });

    expect(db.saveSourceState).toHaveBeenCalledWith({
      sourceKey: 'instagram',
      state: 'healthy',
      reason: null,
      blockedAt: null,
      cookieFileMtimeMsAtBlock: null,
      updatedAt: '2026-06-15T12:00:00.000Z'
    });
    expect(logger.info).toHaveBeenCalledWith(
      'source_unlocked_after_cookie_change',
      {
        source: 'instagram',
        previousCookieFileMtimeMs: 1234,
        currentCookieFileMtimeMs: 5678
      }
    );
  });

  test('keeps blocked source blocked when cookie file is missing', async () => {
    const db = createDb({
      sourceKey: 'instagram',
      state: 'blocked',
      reason: 'auth_required',
      blockedAt: '2026-06-15T11:00:00.000Z',
      cookieFileMtimeMsAtBlock: 1234,
      updatedAt: '2026-06-15T11:00:00.000Z'
    });

    await expect(
      getInstagramSourceAvailability({
        db,
        cookiesPath: '/tmp/instagram-cookies.txt',
        now: '2026-06-15T12:00:00.000Z',
        stat: vi.fn().mockRejectedValue(new Error('ENOENT'))
      })
    ).resolves.toEqual({
      allowed: false,
      reason: 'source_locked'
    });
  });
});
