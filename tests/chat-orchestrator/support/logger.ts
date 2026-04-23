import { vi } from 'vitest';

import type { AppLogger } from '../../../src/logging/logger.js';

export function createLogger(): AppLogger {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn()
  };

  logger.child.mockReturnValue(logger);

  return {
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
    child: logger.child
  };
}
