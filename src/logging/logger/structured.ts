import { formatPrettyLog } from './format.js';
import { shouldWriteLog } from './levels.js';
import type { AppLogger, LogFields, LoggerOptions, LogLevel } from './types.js';

export function createStructuredLogger(
  bindings: LogFields,
  options: LoggerOptions
): AppLogger {
  return {
    child(childBindings) {
      return createStructuredLogger(
        {
          ...bindings,
          ...childBindings
        },
        options
      );
    },

    debug(event, payload = {}) {
      writeLog('debug', event, bindings, payload, options);
    },

    info(event, payload = {}) {
      writeLog('info', event, bindings, payload, options);
    },

    warn(event, payload = {}) {
      writeLog('warn', event, bindings, payload, options);
    },

    error(event, payload = {}) {
      writeLog('error', event, bindings, payload, options);
    }
  };
}

function writeLog(
  level: LogLevel,
  event: string,
  bindings: LogFields,
  payload: LogFields,
  options: LoggerOptions
): void {
  if (!shouldWriteLog(level, options.level ?? 'info')) {
    return;
  }

  const line = formatPrettyLog(
    level,
    event,
    {
      timestamp: new Date().toISOString(),
      ...bindings,
      ...payload
    },
    options
  );

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.info(line);
}
