import type { LogLevel } from './types.js';

export function shouldWriteLog(
  level: LogLevel,
  minimumLevel: LogLevel
): boolean {
  return getLogLevelPriority(level) >= getLogLevelPriority(minimumLevel);
}

function getLogLevelPriority(level: LogLevel): number {
  switch (level) {
    case 'debug':
      return 10;
    case 'info':
      return 20;
    case 'warn':
      return 30;
    case 'error':
      return 40;
  }
}
